import type { LocalProject, SshProject } from '@shared/projects';
import { appState } from './app-state';
import { isUnmountedProject, isUnregisteredProject, MountedProject, ProjectStore } from './project';
import type { ProjectManagerStore } from './project-manager';

/** Returns the ProjectManagerStore from appState. Call only inside `observer` components (or other MobX reactions). */
export function getProjectManagerStore(): ProjectManagerStore {
  return appState.projects;
}

/** Call only inside `observer` components (or other MobX reactions). */
export function getProjectStore(projectId: string): ProjectStore | undefined {
  return getProjectManagerStore().projects.get(projectId);
}

/** Summary for routing the project shell; call only inside `observer` (or other MobX reactions). */
export type ProjectViewKind =
  | 'missing'
  | 'creating'
  | 'bootstrapping'
  | 'mount_error'
  | 'idle_unmounted'
  | 'ready';

export function projectViewKind(store: ProjectStore | undefined): ProjectViewKind {
  if (!store) return 'missing';
  if (isUnregisteredProject(store)) return 'creating';
  if (isUnmountedProject(store)) {
    if (store.phase === 'opening') return 'bootstrapping';
    if (store.phase === 'error') return 'mount_error';
    return 'idle_unmounted';
  }
  return 'ready';
}

/** Returns the mounted project payload if ready, otherwise undefined. */
export function asMounted(store: ProjectStore | undefined): MountedProject | undefined {
  return store?.mountedProject ?? undefined;
}

export function mountedProjectData(
  store: ProjectStore | undefined
): LocalProject | SshProject | null {
  return store?.mountedProject?.data ?? null;
}

/** Returns the display name from any project store variant. */
export function projectDisplayName(store: ProjectStore | undefined): string | undefined {
  return store?.name ?? undefined;
}

export function unmountedMountErrorMessage(store: ProjectStore | undefined): string {
  if (store && isUnmountedProject(store) && store.phase === 'error') {
    return store.error ?? 'Failed to open project';
  }
  return 'Failed to open project';
}
