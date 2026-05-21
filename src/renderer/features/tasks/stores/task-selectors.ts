import { isUnmountedProject } from '@renderer/features/projects/stores/project';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import type { AgentStatus } from '@renderer/features/tasks/conversations/conversation-manager';
import type { DiffViewStore } from '@renderer/features/tasks/diff-view/stores/diff-view-store';
import type { FileModelLifecycleStore } from '@renderer/features/tasks/editor/stores/file-model-lifecycle-store';
import type { Task } from '@shared/tasks';
import { conversationRegistry } from './conversation-registry';
import type { TaskManagerStore } from './task-manager';
import {
  isProvisioned,
  isRegistered,
  isUnprovisioned,
  isUnregistered,
  registeredTaskData,
  type TaskStore,
} from './task-store';
import { terminalRegistry } from './terminal-registry';
import { workspaceRegistry } from './workspace-registry';
import type { WorkspaceViewModel } from './workspace-view-model';

/** Call only inside `observer` components (or other MobX reactions). */
export function getTaskManagerStore(projectId: string): TaskManagerStore | undefined {
  const p = getProjectManagerStore().projects.get(projectId);
  return p?.mountedProject?.taskManager;
}

/** Call only inside `observer` components (or other MobX reactions). */
export function getTaskStore(projectId: string, taskId: string): TaskStore | undefined {
  return getTaskManagerStore(projectId)?.tasks.get(taskId);
}

/** Registered task payload (`Task`) when the row exists and is not unregistered; otherwise undefined. */
export function getRegisteredTaskData(projectId: string, taskId: string): Task | undefined {
  const store = getTaskStore(projectId, taskId);
  if (!store) return undefined;
  return registeredTaskData(store);
}

/** Call only inside `observer` components (or other MobX reactions). */
export function getTaskView(projectId: string, taskId: string): WorkspaceViewModel | undefined {
  return getTaskStore(projectId, taskId)?.viewModel ?? undefined;
}

/** Call only inside `observer` components (or other MobX reactions). */
export function getEditorView(
  projectId: string,
  taskId: string
): FileModelLifecycleStore | undefined {
  return getTaskView(projectId, taskId)?.editorView;
}

/** Call only inside `observer` components (or other MobX reactions). */
export function getDiffView(projectId: string, taskId: string): DiffViewStore | undefined {
  return getTaskView(projectId, taskId)?.diffView ?? undefined;
}

export function getTaskGitStore(projectId: string, taskId: string) {
  const store = getTaskStore(projectId, taskId);
  if (!store?.workspaceId) return undefined;
  return workspaceRegistry.get(projectId, store.workspaceId)?.git;
}

export function taskAgentStatus(store: TaskStore): AgentStatus | null {
  const mgr = conversationRegistry.get(store.data.id);
  return mgr?.taskStatus ?? null;
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
  | 'needs-resolution'
  | 'ready';

/**
 * Derives the task view kind from the project + task store state.
 *
 * Pass `projectId` so that "project still opening" can be distinguished from
 * "task genuinely missing". Call only inside `observer` components.
 */
export function taskViewKind(store: TaskStore | undefined, projectId: string): TaskViewKind {
  const projectStore = getProjectManagerStore().projects.get(projectId);

  if (!projectStore) return 'missing';

  if (isUnmountedProject(projectStore)) {
    if (projectStore.phase === 'opening') return 'project-mounting';
    if (projectStore.phase === 'error') return 'project-error';
    return 'project-mounting';
  }

  if (projectStore.state === 'unregistered') return 'missing';

  if (!store) return 'missing';

  if (isUnregistered(store)) {
    if (store.phase === 'creating') return 'creating';
    return 'create-error';
  }
  if (isUnprovisioned(store)) {
    if (store.phase === 'provision') {
      const wsId = isRegistered(store) ? (store.data as Task).workspaceId : null;
      if (wsId) {
        const bs = workspaceRegistry.bootstrapStateFor(projectId, wsId);
        if (bs?.kind === 'needs-resolution') return 'needs-resolution';
      }
      return 'provisioning';
    }
    if (store.phase === 'provision-error') return 'provision-error';
    if (store.phase === 'teardown') return 'teardown';
    if (store.phase === 'teardown-error') return 'teardown-error';
    return 'idle';
  }
  return 'ready';
}

/** Returns the narrowed provisioned task store if the task is provisioned, otherwise undefined. */
export function asProvisioned(
  store: TaskStore | undefined
): (TaskStore & { state: 'provisioned'; workspaceId: string }) | undefined {
  return store && isProvisioned(store) ? store : undefined;
}

// ---------------------------------------------------------------------------
// New focused selectors (Phase 4)
// ---------------------------------------------------------------------------

export function getWorkspaceForTask(projectId: string, taskId: string) {
  const wsId = getTaskStore(projectId, taskId)?.workspaceId;
  return wsId ? (workspaceRegistry.get(projectId, wsId) ?? undefined) : undefined;
}

export function getWorkspaceViewModel(
  projectId: string,
  taskId: string
): WorkspaceViewModel | undefined {
  return getTaskStore(projectId, taskId)?.viewModel ?? undefined;
}

export function getConversationsForTask(taskId: string) {
  return conversationRegistry.get(taskId);
}

export function getTerminalsForTask(taskId: string) {
  return terminalRegistry.get(taskId);
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
