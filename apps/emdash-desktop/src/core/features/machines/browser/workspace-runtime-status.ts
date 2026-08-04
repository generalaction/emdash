import type { ProjectWorkspaceRow } from '@core/primitives/workspaces/api';

export type WorkspaceRuntimeStatus = 'idle' | 'setting-up' | 'active' | 'tearing-down' | 'error';

const STATUS_PRIORITY: WorkspaceRuntimeStatus[] = [
  'error',
  'tearing-down',
  'setting-up',
  'active',
  'idle',
];

export function workspaceStatus(row: ProjectWorkspaceRow): WorkspaceRuntimeStatus {
  return row.hasActiveSessions ? 'active' : 'idle';
}

export function aggregateWorkspaceStatus(
  statuses: readonly WorkspaceRuntimeStatus[]
): WorkspaceRuntimeStatus {
  for (const status of STATUS_PRIORITY) {
    if (statuses.includes(status)) return status;
  }
  return 'idle';
}
