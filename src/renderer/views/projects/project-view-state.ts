import type { LocalProject, SshProject } from '@shared/projects';
import type { ProjectStore } from '@renderer/core/stores/project';
import { projectManagerStore } from '@renderer/core/stores/project-manager';

/** Summary for routing the project shell; call only inside `observer` (or other MobX reactions). */
export type ProjectViewKind =
  | 'missing'
  | 'creating'
  | 'bootstrapping'
  | 'mount_error'
  | 'idle_unmounted'
  | 'ready';

export function getProjectStore(projectId: string): ProjectStore | undefined {
  return projectManagerStore.projects.get(projectId);
}

export function projectViewKind(store: ProjectStore | undefined): ProjectViewKind {
  if (!store) return 'missing';
  if (store.state === 'unregistered') return 'creating';
  if (store.state === 'unmounted') {
    if (store.phase === 'opening') return 'bootstrapping';
    if (store.phase === 'error') return 'mount_error';
    return 'idle_unmounted';
  }
  return 'ready';
}

export function mountedProjectData(
  store: ProjectStore | undefined
): LocalProject | SshProject | null {
  if (store?.state === 'mounted') return store.data;
  return null;
}

export function unmountedMountErrorMessage(store: ProjectStore | undefined): string {
  if (store?.state === 'unmounted' && store.phase === 'error') {
    return store.error ?? 'Failed to open project';
  }
  return 'Failed to open project';
}
