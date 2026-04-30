import type { LocalProject, SshProject } from '@shared/projects';
import { appState } from '@renderer/lib/stores/app-state';
import type { PrSyncStore } from './pr-sync-store';
import { isUnmountedProject, isUnregisteredProject, type MountedProject, type ProjectStore } from './project';
import type { ProjectManagerStore } from './project-manager';
import type { ProjectSettingsStore } from './project-settings-store';
import type { RepositoryStore } from './repository-store';

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
  | 'path_not_found'
  | 'ssh_disconnected'
  | 'idle_unmounted'
  | 'ready';

export function projectViewKind(store: ProjectStore | undefined): ProjectViewKind {
  if (!store) return 'missing';
  if (isUnregisteredProject(store)) return 'creating';
  if (isUnmountedProject(store)) {
    if (store.phase === 'opening') return 'bootstrapping';
    if (store.phase === 'error') {
      if (store.errorCode === 'path-not-found') return 'path_not_found';
      if (store.errorCode === 'ssh-disconnected') return 'ssh_disconnected';
      return 'mount_error';
    }
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
    if (store.errorCode === 'path-not-found') {
      return `No project found at ${store.error ?? 'the configured path'}`;
    }
    return store.error ?? 'Failed to open project';
  }
  return 'Failed to open project';
}

/** Returns the RepositoryStore for a mounted project, or undefined if not ready. */
export function getRepositoryStore(projectId: string): RepositoryStore | undefined {
  return asMounted(getProjectStore(projectId))?.repository;
}

/** Returns the ProjectSettingsStore for a mounted project, or undefined if not ready. */
export function getProjectSettingsStore(projectId: string): ProjectSettingsStore | undefined {
  return asMounted(getProjectStore(projectId))?.settings;
}

/** Returns the PrSyncStore for a mounted project, or undefined if not ready. */
export function getPrSyncStore(projectId: string): PrSyncStore | undefined {
  return asMounted(getProjectStore(projectId))?.prSync;
}
