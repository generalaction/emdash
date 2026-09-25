import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { workspaceRegistryContract } from '@emdash/core/runtimes/workspace-registry/api';
import {
  createWorkspaceRegistryController,
  workspaceRegistryStore,
  WorkspaceRegistryRuntime,
} from '@emdash/core/runtimes/workspace-registry/node';
import { LocalAttachmentStore } from '@emdash/core/services/attachments/node';
import { ok } from '@emdash/shared';
import { createTestWire } from '@emdash/wire/testing';
import { openFixture } from '@tooling/utils/db';
import { expect, it, vi } from 'vitest';
import { createConversationsWireController } from '@core/features/conversations/node/wire-controller';
import { deleteProject } from '@core/features/projects/node/operations/deleteProject';
import { registerRepositoryWorkspace } from '@core/features/projects/node/operations/register-repository-workspace';
import { TaskSessionLaunchContextResolver } from '@core/features/tasks/api/node/task-session-launch-context';
import { createTask } from '@core/features/tasks/node/operations/createTask';
import { WorkspaceCreations } from '@core/features/workspaces/api/node/registry-verbs';
import { createWorkspaceIdentityService } from '@core/features/workspaces/node/workspace-identity-source';

// Real desktop and Host registries exercise canonical ID reuse; the ACP process
// boundary and unrelated project services are stubbed.
it.each(['claude', 'codex'] as const)(
  'launches %s after removing and re-adding a directory project',
  async (agent) => {
    const directory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'emdash-directory-session-'))
    );
    const fixture = await openFixture('empty');
    const handle = await workspaceRegistryStore.openTemp();
    const runtime = new WorkspaceRegistryRuntime({
      attachments: new LocalAttachmentStore(path.join(directory, '.test-attachments')),
      handle,
    });
    const wire = createTestWire(
      workspaceRegistryContract,
      createWorkspaceRegistryController(runtime)
    );
    try {
      const registered = await wire.client.createWorkspace({
        workspaceId: 'directory',
        path: directory,
      });
      expect(registered).toMatchObject({ success: true, data: { kind: 'directory' } });
      if (!registered.success) throw new Error('Registration failed');
      expect(
        registerRepositoryWorkspace(fixture.db, {
          host: LOCAL_HOST_REF,
          record: registered.data,
          project: { id: 'project', name: 'Directory', baseRef: null },
        }).success
      ).toBe(true);

      const provider = {
        project: { id: 'project', repositoryWorkspaceId: 'directory' },
        repoPath: directory,
        host: LOCAL_HOST_REF,
        workspaceRegistry: wire.client,
        settings: {
          getStoredGitSettings: async () => ({}),
          getPlacementContext: async () => ({
            hostWorktreeRoot: null,
            builtInWorktreeRoot: '/tmp/worktrees',
            homeDirectory: '/tmp',
            hostTmux: null,
            appDefaultTmux: false,
          }),
          resolveTmux: async () => ({ value: false, provenance: { kind: 'default' } }),
        },
        repoFacts: { get: async () => ({ remotes: [], localBranches: [] }) },
      };
      const projects = { requireAttached: () => ok(provider as never) };
      const attach = vi.fn(async () => ok({ sessionId: null }));
      const hostClient = {
        workspaceRegistry: wire.client,
        conversations: { create: async () => ok(undefined) },
        acp: { attach },
      };
      const runtimes = { client: async () => ok(hostClient as never) };
      const workspaceIdentity = createWorkspaceIdentityService({ db: fixture.db });
      const sessionLaunchContexts = new TaskSessionLaunchContextResolver({
        db: fixture.db,
        projects,
        runtimes,
        workspaceIdentity,
      });
      const controller = createConversationsWireController({
        terminalFileSources: { prepare: vi.fn() },
        db: fixture.db,
        logger: { warn: vi.fn() } as never,
        runtimes,
        workspaceIdentity,
        sessionLaunchContexts,
        telemetry: { capture: vi.fn() } as never,
        projects,
        taskSessions: { getTask: vi.fn() },
        withCompensation: async ({ action }) => action(),
        hostIsReachable: () => true,
      });

      async function createAndAttachTask(projectId: string): Promise<void> {
        const taskId = `${projectId}-${agent}`;
        const conversationId = `conversation-${taskId}`;
        const created = await createTask(
          fixture.db,
          projects,
          { resolveWorktreeRoot: vi.fn() },
          runtimes,
          new WorkspaceCreations(),
          {
            id: taskId,
            projectId,
            taskConfig: {
              version: '1',
              name: `Task ${agent}`,
              initialConversation: { id: conversationId, provider: agent, type: 'acp' },
            },
            workspaceConfig: {
              version: '2',
              git: { kind: 'none' },
              workspace: { kind: 'repository-instance', workspaceId: 'directory' },
            },
          }
        );
        expect(created.success).toBe(true);
        expect(await wire.client.activateWorkspace({ workspaceId: 'directory' })).toMatchObject({
          success: true,
        });
        await expect(controller.call('acp.attach', { conversationId })).resolves.toEqual(
          ok({ sessionId: null })
        );
      }

      await createAndAttachTask('project');
      expect(attach).toHaveBeenCalledTimes(1);

      const deleted = await deleteProject(
        {
          db: fixture.db,
          runtimes,
          projects: { invalidate: async () => {} },
          automations: { removeProjectDeployments: async () => {} },
          pullRequests: { deleteProjectData: async () => {} },
          getMementosRuntimeClient: async () =>
            ({
              deleteBySubject: async () => ok(undefined),
              deleteOrphans: async () => ok(undefined),
            }) as never,
          sessionCleanup: {
            resolve: async () => ({
              acpConversationIds: [],
              tuiConversationIds: [],
              terminalSessionIds: [],
              tmuxSessionIdentities: [],
            }),
            killAcp: async () => {},
            killTerminals: async () => {},
          },
          logger: { warn: vi.fn() } as never,
          telemetry: { capture: vi.fn() },
        },
        'project'
      );
      expect(deleted.success).toBe(true);
      const reRegistered = await wire.client.createWorkspace({
        workspaceId: 'new-directory',
        path: directory,
      });
      expect(reRegistered).toMatchObject({ success: true, data: { id: 'directory' } });
      if (!reRegistered.success) throw new Error('Re-registration failed');
      expect(
        registerRepositoryWorkspace(fixture.db, {
          host: LOCAL_HOST_REF,
          record: reRegistered.data,
          project: { id: 'replacement-project', name: 'Directory re-added', baseRef: null },
        }).success
      ).toBe(true);
      provider.project.id = 'replacement-project';
      await createAndAttachTask('replacement-project');
      expect(attach).toHaveBeenCalledTimes(2);
    } finally {
      await wire.dispose();
      runtime.dispose();
      handle.close();
      fixture.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
);
