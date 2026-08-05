import { err, ok, type Result } from '@emdash/shared';
import type { ProjectProvider } from '@main/core/projects/project-provider';
import { runtimeManager } from '@main/core/runtime/runtime-manager';
import type { MachineRef } from '@main/core/runtime/types';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import type { Task } from '@shared/core/tasks/tasks';
import type { TeardownTaskError } from '../tasks/provision-task-error';
import { createWorkspaceFactory, type WorkspaceType } from './workspace-factory';
import {
  workspaceRegistry,
  type WorkspaceFactoryResult,
  type WorkspaceTeardownMode,
} from './workspace-registry';

type StoredWorkspace = {
  id: string;
  type: 'byoi' | 'local' | 'project-ssh';
  kind: 'byoi' | 'project-root' | 'worktree' | null;
  location: 'local' | 'remote' | null;
  sshConnectionId: string | null;
  path: string | null;
};

type StoredWorkspaceTeardownMode = Extract<
  WorkspaceTeardownMode,
  'archive' | 'terminate' | 'terminate-provider'
>;

async function resolveStoredWorkspaceTarget(
  workspace: StoredWorkspace
): Promise<{ type: WorkspaceType; machine: MachineRef } | null> {
  const location =
    workspace.location ??
    (workspace.type === 'project-ssh' ? 'remote' : workspace.type === 'local' ? 'local' : null);

  if (location === 'local') {
    return { type: { kind: 'local' }, machine: { kind: 'local' } };
  }
  if (location !== 'remote' || !workspace.sshConnectionId) return null;

  const connectionId = workspace.sshConnectionId;
  const proxy = await sshConnectionManager.connect(connectionId);
  return {
    type: { kind: 'ssh', proxy, connectionId },
    machine: { kind: 'ssh', connectionId },
  };
}

/**
 * Reopens a previously provisioned workspace only far enough to run its teardown hooks.
 * Setup/run hooks and activation side effects are intentionally omitted: this path is for
 * tasks whose live session was not mounted in the current app process.
 */
export async function teardownStoredWorkspace({
  task,
  workspace,
  project,
  mode,
}: {
  task: Pick<Task, 'id' | 'name'>;
  workspace: StoredWorkspace;
  project: ProjectProvider;
  mode: StoredWorkspaceTeardownMode;
}): Promise<Result<boolean, TeardownTaskError>> {
  if (!workspace.path) return ok(false);
  if (workspace.kind === 'byoi' || workspace.type === 'byoi') {
    return err({
      type: 'error',
      message:
        'Cannot safely teardown a cold BYOI workspace because its provider connection is not mounted.',
    });
  }

  const target = await resolveStoredWorkspaceTarget(workspace);
  if (!target) {
    return err({
      type: 'error',
      message: `Cannot safely teardown stored workspace ${workspace.id}: its persisted transport is unavailable.`,
    });
  }

  const createWorkspace = createWorkspaceFactory(workspace.id, target.type, {
    task,
    workDir: workspace.path,
    projectId: project.projectId,
    projectPath: project.repoPath,
    workspaceRuntime: {
      machine: target.machine,
      manager: runtimeManager,
    },
    settings: project.settings,
    logPrefix: 'StoredWorkspaceTeardown',
    gitRepository: project.gitRepository,
    gitRepositoryFetchService: project.gitRepositoryFetchService,
  });

  await workspaceRegistry.acquire(workspace.id, project.projectId, async () => {
    const created = await createWorkspace();
    const teardownOnly: WorkspaceFactoryResult = {
      workspace: created.workspace,
      sshFilesRuntime: created.sshFilesRuntime,
      onArchive: created.onArchive,
      onDestroy: created.onDestroy,
      onProviderDestroy: created.onProviderDestroy,
      onDetach: created.onDetach,
    };
    return teardownOnly;
  });
  await workspaceRegistry.teardown(workspace.id, mode);
  return ok(true);
}
