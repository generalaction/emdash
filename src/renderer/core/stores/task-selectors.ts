import type { TaskAgentStatus } from './conversation-manager';
import { isUnmountedProject } from './project';
import { getProjectManagerStore } from './project-selectors';
import { isUnprovisioned, isUnregistered, ProvisionedTask, TaskStore } from './task';
import type { TaskManagerStore } from './task-manager';

/** Call only inside `observer` components (or other MobX reactions). */
export function getTaskManagerStore(projectId: string): TaskManagerStore | undefined {
  const p = getProjectManagerStore().projects.get(projectId);
  return p?.mountedProject?.taskManager;
}

/** Call only inside `observer` components (or other MobX reactions). */
export function getTaskStore(projectId: string, taskId: string): TaskStore | undefined {
  return getTaskManagerStore(projectId)?.tasks.get(taskId);
}

export function getTaskGitStore(projectId: string, taskId: string) {
  return asProvisioned(getTaskStore(projectId, taskId))?.workspace.git;
}

export function taskAgentStatus(store: TaskStore): TaskAgentStatus {
  return asProvisioned(store)?.conversations.taskStatus ?? null;
}

export type TaskViewKind =
  | 'missing'
  | 'project-mounting' // project is still opening — task data not yet available
  | 'project-error' // project failed to open
  | 'creating'
  | 'create-error'
  | 'provisioning'
  | 'provision-error'
  | 'teardown'
  | 'teardown-error'
  | 'idle'
  | 'ready';

/**
 * Derives the task view kind from the project + task store state.
 *
 * Pass `projectId` so that "project still opening" can be distinguished from
 * "task genuinely missing". Call only inside `observer` components.
 */
export function taskViewKind(store: TaskStore | undefined, projectId: string): TaskViewKind {
  const projectStore = getProjectManagerStore().projects.get(projectId);

  // Project doesn't exist at all
  if (!projectStore) return 'missing';

  // Project is being opened — tasks won't be available yet
  if (isUnmountedProject(projectStore)) {
    if (projectStore.phase === 'opening') return 'project-mounting';
    if (projectStore.phase === 'error') return 'project-error';
    // idle/closing unmounted — still needs to be opened
    return 'project-mounting';
  }

  // Project is still being created (unregistered)
  if (projectStore.state === 'unregistered') return 'missing';

  // Project is mounted — dispatch on task state
  if (!store) return 'missing';

  if (isUnregistered(store)) {
    if (store.phase === 'creating') return 'creating';
    return 'create-error';
  }
  if (isUnprovisioned(store)) {
    if (store.phase === 'provision') return 'provisioning';
    if (store.phase === 'provision-error') return 'provision-error';
    if (store.phase === 'teardown') return 'teardown';
    if (store.phase === 'teardown-error') return 'teardown-error';
    return 'idle';
  }
  return 'ready';
}

/** Returns the provisioned task payload if ready, otherwise undefined. */
export function asProvisioned(store: TaskStore | undefined): ProvisionedTask | undefined {
  return store?.provisionedTask ?? undefined;
}

/** Returns the display name from any task store variant. */
export function taskDisplayName(store: TaskStore | undefined): string | undefined {
  if (!store) return undefined;
  return store.data.name;
}

/** Returns the error message for error states. */
export function taskErrorMessage(store: TaskStore | undefined): string | undefined {
  if (!store) return undefined;
  if (isUnregistered(store) && store.phase === 'create-error') {
    return store.errorMessage ?? 'Failed to create task';
  }
  if (isUnprovisioned(store)) {
    if (store.phase === 'provision-error') {
      return store.errorMessage ?? 'Failed to set up workspace';
    }
    if (store.phase === 'teardown-error') {
      return store.errorMessage ?? 'Failed to tear down task';
    }
  }
  return undefined;
}

/** Returns the mount error message for the project. */
export function projectMountErrorMessage(projectId: string): string {
  const store = getProjectManagerStore().projects.get(projectId);
  if (store && isUnmountedProject(store) && store.phase === 'error') {
    return store.error ?? 'Failed to open project';
  }
  return 'Failed to open project';
}
