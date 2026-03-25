import { projectManagerStore } from '@renderer/core/stores/project-manager';
import type {
  ProvisionedTaskStore,
  TaskStore,
  UnprovisionedTaskStore,
  UnregisteredTaskStore,
} from '@renderer/core/stores/task';
import type { TaskManagerStore } from '@renderer/core/stores/task-manager';

/** Call only inside `observer` components (or other MobX reactions). */
export function getTaskManagerStore(projectId: string): TaskManagerStore | undefined {
  const p = projectManagerStore.projects.get(projectId);
  return p?.state === 'mounted' ? p.taskManager : undefined;
}

/** Call only inside `observer` components (or other MobX reactions). */
export function getTaskStore(projectId: string, taskId: string): TaskStore | undefined {
  return getTaskManagerStore(projectId)?.tasks.get(taskId);
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
  const projectStore = projectManagerStore.projects.get(projectId);

  // Project doesn't exist at all
  if (!projectStore) return 'missing';

  // Project is being opened — tasks won't be available yet
  if (projectStore.state === 'unmounted') {
    if (projectStore.phase === 'opening') return 'project-mounting';
    if (projectStore.phase === 'error') return 'project-error';
    // idle/closing unmounted — still needs to be opened
    return 'project-mounting';
  }

  // Project is still being created (unregistered)
  if (projectStore.state === 'unregistered') return 'missing';

  // Project is mounted — dispatch on task state
  if (!store) return 'missing';

  if (store.state === 'unregistered') {
    if (store.phase === 'creating') return 'creating';
    return 'create-error';
  }
  if (store.state === 'unprovisioned') {
    if (store.phase === 'provision') return 'provisioning';
    if (store.phase === 'provision-error') return 'provision-error';
    if (store.phase === 'teardown') return 'teardown';
    if (store.phase === 'teardown-error') return 'teardown-error';
    return 'idle';
  }
  return 'ready';
}

/** Returns the mount error message for the project. */
export function projectMountErrorMessage(projectId: string): string {
  const store = projectManagerStore.projects.get(projectId);
  if (store?.state === 'unmounted' && store.phase === 'error') {
    return store.error ?? 'Failed to open project';
  }
  return 'Failed to open project';
}

export function provisionedTask(store: TaskStore | undefined): ProvisionedTaskStore | undefined {
  if (store?.state === 'provisioned') return store;
  return undefined;
}

/** Returns the display name from any task store variant. */
export function taskDisplayName(store: TaskStore | undefined): string | undefined {
  if (!store) return undefined;
  return store.data.name;
}

/** Returns the error message for error states. */
export function taskErrorMessage(store: TaskStore | undefined): string | undefined {
  if (store?.state === 'unregistered' && store.phase === 'create-error') {
    return store.errorMessage ?? 'Failed to create task';
  }
  if (store?.state === 'unprovisioned') {
    if (store.phase === 'provision-error') {
      return store.errorMessage ?? 'Failed to set up workspace';
    }
    if (store.phase === 'teardown-error') {
      return store.errorMessage ?? 'Failed to tear down task';
    }
  }
  return undefined;
}

export function asUnregistered(store: TaskStore | undefined): UnregisteredTaskStore | undefined {
  return store?.state === 'unregistered' ? store : undefined;
}

export function asUnprovisioned(store: TaskStore | undefined): UnprovisionedTaskStore | undefined {
  return store?.state === 'unprovisioned' ? store : undefined;
}
