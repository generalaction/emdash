import { hostRef, LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import { ROOT_RELATIVE_PATH, type HostAbsolutePath } from '@emdash/core/primitives/path/api';
import type { GitPathInspection, InspectPathError } from '@emdash/core/runtimes/git/api';
import { err, ok, type Result } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { waitFor } from '@emdash/shared/testing';
import type { LiveSource } from '@emdash/wire/rpc';
import { cell, observe, remote, snapshot, whenReady } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { describe, expect, it, vi } from 'vitest';
import { projectsWireContract, type ProjectAttachmentState } from '@core/features/projects/api';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import type { ProjectOperationDependencies } from './controller';
import { getProjectPathStatus } from './operations/project-path-status';
import { createProjectsWireController } from './wire-controller';

describe('Projects Wire attachments', () => {
  it('does not expose renderer-driven Project opening', () => {
    expect(projectsWireContract).not.toHaveProperty('openProject');
  });

  it('leases tracked attachment state and forwards recovery through Projects ownership', async () => {
    const state = cell<ProjectAttachmentState>({
      kind: 'attached',
      establishedHostGeneration: 3,
    });
    let leases = 0;
    const recover = vi.fn(async () => ok());
    const projects = {
      track: vi.fn((_projectId, owner) => {
        leases += 1;
        owner.add(() => {
          leases -= 1;
        });
        return state;
      }),
      recover,
    } as unknown as ProjectAttachmentManager;
    const controller = createProjectsWireController({
      projects,
    } as unknown as ProjectOperationDependencies);
    const wire = createTestWire(projectsWireContract, controller.impl);
    const scope = createScope({ label: 'projects-attachments-wire-test' });
    const attachments = remote(projectsWireContract.attachments, wire.client.attachments, {
      scope,
      lingerMs: 0,
    });
    const member = attachments({ projectId: 'project-1' });
    observe(member.states.state, () => {}, { scope, immediate: true });

    expect((await whenReady(member.states.state, { scope })).value).toEqual({
      kind: 'attached',
      establishedHostGeneration: 3,
    });
    expect(snapshot(member.states.state).value).toEqual({
      kind: 'attached',
      establishedHostGeneration: 3,
    });
    expect(leases).toBe(1);

    await expect(wire.client.recoverAttachment({ projectId: 'project-1' })).resolves.toEqual(ok());
    expect(recover).toHaveBeenCalledWith('project-1');

    await scope.dispose();
    expect(leases).toBe(1);

    const reconnectedScope = createScope({ label: 'projects-attachments-wire-reconnect-test' });
    const reconnectedAttachments = remote(
      projectsWireContract.attachments,
      wire.client.attachments,
      {
        scope: reconnectedScope,
        lingerMs: 0,
      }
    );
    const reconnectedMember = reconnectedAttachments({ projectId: 'project-1' });
    observe(reconnectedMember.states.state, () => {}, {
      scope: reconnectedScope,
      immediate: true,
    });
    await whenReady(reconnectedMember.states.state, { scope: reconnectedScope });

    expect(projects.track).toHaveBeenCalledOnce();
    expect(leases).toBe(1);

    await reconnectedScope.dispose();
    await wire.dispose();
    await controller.dispose();
    await waitFor(() => leases === 0);
  });
});

describe('Projects Wire directory tree', () => {
  it('browses and inspects the selected host even when the same path exists locally', async () => {
    const root: HostAbsolutePath = { root: { kind: 'posix' }, segments: ['workspace'] };
    const remoteHost = hostRef('remote', 'ssh-nixos');
    function hostRuntime(directoryName: string) {
      const source = liveSource({
        root,
        entries: {
          '': {
            path: '',
            name: directoryName,
            parentPath: null,
            kind: 'directory',
            childrenLoaded: true,
            children: [],
          },
        },
      });
      return {
        files: {
          tree: { model: { state: vi.fn(() => ({ asLiveSource: () => source })) } },
          fs: { stat: vi.fn(async () => ok({ type: 'directory' as const })) },
        },
        git: {
          inspectPath: vi.fn(
            async (): Promise<Result<GitPathInspection, InspectPathError>> =>
              ok({ kind: 'repository' as const, rootPath: root, baseRef: 'main' })
          ),
        },
      };
    }
    const local = hostRuntime('local-folder');
    const remote = hostRuntime('remote-folder');
    const client = vi.fn(async (host: HostRef) => {
      if (host.type === 'local') return ok(local);
      expect(host).toEqual(remoteHost);
      return ok(remote);
    });
    const dependencies = { runtimes: { client } } as unknown as ProjectOperationDependencies;
    const controller = createProjectsWireController(dependencies);
    try {
      const directoryTree = controller.impl.directoryTree;
      if (directoryTree?.kind !== 'liveModelProvider')
        throw new Error('Expected directory tree provider');
      const source = await directoryTree.resolveState(
        { type: 'ssh', connectionId: remoteHost.id, root, sessionId: 'remote-picker' },
        'tree'
      );
      if (!source) throw new Error('Expected the remote directory tree');
      expect((await source.snapshot()).data).toMatchObject({
        entries: { '': { name: 'remote-folder' } },
      });
      await expect(getProjectPathStatus(dependencies, remoteHost, '/workspace')).resolves.toEqual({
        isDirectory: true,
        isGitRepo: true,
      });
      expect(remote.files.fs.stat).toHaveBeenCalledOnce();
      expect(remote.git.inspectPath).toHaveBeenCalledWith({ path: root });
      expect(local.files.tree.model.state).not.toHaveBeenCalled();
      expect(local.files.fs.stat).not.toHaveBeenCalled();
      expect(local.git.inspectPath).not.toHaveBeenCalled();
      expect(client).not.toHaveBeenCalledWith(LOCAL_HOST_REF);

      remote.git.inspectPath.mockResolvedValueOnce(
        err({ type: 'inspect-failed', path: root, message: 'spawn git ENOENT' })
      );
      await expect(getProjectPathStatus(dependencies, remoteHost, '/workspace')).resolves.toEqual({
        isDirectory: true,
        isGitRepo: false,
        error: { type: 'inspect-failed', path: '/workspace', message: 'spawn git ENOENT' },
      });
      expect(local.git.inspectPath).not.toHaveBeenCalled();
    } finally {
      await controller.dispose();
    }
  });

  it('uses children-scoped watching for both picker state and mutations', async () => {
    const root: HostAbsolutePath = {
      root: { kind: 'posix' },
      segments: ['home', 'dev'],
    };
    const source = liveSource({
      root,
      entries: {
        '': {
          path: '',
          name: 'dev',
          parentPath: null,
          kind: 'directory',
          childrenLoaded: false,
          children: [],
        },
      },
    });
    const state = vi.fn(() => ({ asLiveSource: () => source }));
    const mutate = vi.fn(async () => err({ type: 'not-found' as const, path: '' }));
    const client = vi.fn(async () => ok({ files: { tree: { model: { state, mutate } } } }));
    const controller = createProjectsWireController({
      runtimes: { client },
    } as unknown as ProjectOperationDependencies);
    const key = {
      type: 'ssh' as const,
      connectionId: 'ssh-2',
      root,
      sessionId: 'picker-1',
    };
    const directoryTree = controller.impl.directoryTree;
    if (directoryTree?.kind !== 'liveModelProvider') {
      throw new Error('Expected the Projects directory tree provider');
    }

    await directoryTree.resolveState(key, 'tree');
    expect(state).toHaveBeenCalledWith(
      { root, sessionId: 'picker-1', watchScope: 'children' },
      'tree'
    );

    await directoryTree.runMutation('reveal', {
      key,
      input: { path: ROOT_RELATIVE_PATH, depth: 2 },
      mutationId: 'reveal-1',
    });
    expect(mutate).toHaveBeenCalledWith('reveal', {
      key: { root, sessionId: 'picker-1', watchScope: 'children' },
      input: { path: ROOT_RELATIVE_PATH, depth: 2 },
      mutationId: 'reveal-1',
    });

    await controller.dispose();
  });
});

function liveSource(data: unknown): LiveSource {
  return {
    snapshot: async () => ({ generation: 1, sequence: 0, timestamp: 0, data }),
    subscribe: () => () => {},
  };
}
