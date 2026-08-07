import {
  isUnmountedProject,
  isUnregisteredProject,
  type MountedProject,
  type ProjectStore,
} from '@core/features/projects/api/browser/stores/project';
import type { ProjectManagerStore } from '@core/features/projects/api/browser/stores/project-manager';
import type { ProjectSettingsStore } from '@core/features/projects/api/browser/stores/project-settings-store';
import { projectManagerStoreToken } from '@core/features/projects/contributions/app-store-tokens';
import {
  projectSettingsStoreToken,
  projectViewStoreToken,
} from '@core/features/projects/contributions/project-stores';
import type { LocalProject, SshProject } from '@core/primitives/projects/api';
import { getAppStores } from '@core/primitives/scoped-stores/browser';
import type { ProjectViewStore } from '../../../browser/stores/project-view';

/** Returns the app-scoped ProjectManagerStore. Call only inside `observer` components (or other MobX reactions). */
export function getProjectManagerStore(): ProjectManagerStore {
  return getAppStores().get(projectManagerStoreToken);
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
    if (store.unmounted.kind === 'opening') return 'bootstrapping';
    if (store.unmounted.kind === 'failed') {
      if (store.unmounted.code === 'path-not-found') return 'path_not_found';
      if (store.unmounted.code === 'ssh-disconnected') return 'ssh_disconnected';
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

/** Returns the id of the first mounted project, or undefined if none are mounted. */
export function firstMountedProjectId(): string | undefined {
  for (const [id, store] of getProjectManagerStore().projects.entries()) {
    if (asMounted(store)) return id;
  }
  return undefined;
}

export function mountedProjectData(
  store: ProjectStore | undefined
): LocalProject | SshProject | null {
  return store?.mountedProject?.data ?? null;
}

/** Returns the SSH connection id for a mounted SSH project, otherwise undefined. */
export function getProjectSshConnectionId(projectId: string): string | undefined {
  const data = mountedProjectData(getProjectStore(projectId));
  return data?.type === 'ssh' ? data.connectionId : undefined;
}

/** Returns the display name from any project store variant. */
export function projectDisplayName(store: ProjectStore | undefined): string | undefined {
  return store?.name ?? undefined;
}

export function unmountedMountErrorMessage(store: ProjectStore | undefined): string {
  if (store && isUnmountedProject(store) && store.unmounted.kind === 'failed') {
    if (store.unmounted.code === 'path-not-found') {
      return `No project found at ${store.unmounted.message || 'the configured path'}`;
    }
    return store.unmounted.message || 'Failed to open project';
  }
  return 'Failed to open project';
}

/** Returns the ProjectSettingsStore for a mounted project, or undefined if not ready. */
export function getProjectSettingsStore(projectId: string): ProjectSettingsStore | undefined {
  return asMounted(getProjectStore(projectId))?.get(projectSettingsStoreToken);
}

/** Returns the ProjectViewStore for a mounted project, or undefined if not ready. */
export function getProjectViewStore(projectId: string): ProjectViewStore | undefined {
  return asMounted(getProjectStore(projectId))?.get(projectViewStoreToken);
}
