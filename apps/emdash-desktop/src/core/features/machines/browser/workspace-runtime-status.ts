import type { ObservableMap } from 'mobx';
import type { ProjectWorkspaceRow } from '@core/primitives/workspaces/api';
import type { WorkspaceRuntimeStatus } from './use-workspace-runtime-statuses';

const STATUS_PRIORITY: WorkspaceRuntimeStatus[] = ['tearing-down', 'setting-up', 'active', 'idle'];

export function workspaceStatus(
  row: ProjectWorkspaceRow,
  statuses: ObservableMap<string, WorkspaceRuntimeStatus>
): WorkspaceRuntimeStatus {
  if (!row.workspaceId) return row.hasActiveSessions ? 'active' : 'idle';
  return statuses.get(row.workspaceId) ?? (row.hasActiveSessions ? 'active' : 'idle');
}

export function aggregateWorkspaceStatus(
  statuses: readonly WorkspaceRuntimeStatus[]
): WorkspaceRuntimeStatus {
  for (const status of STATUS_PRIORITY) {
    if (statuses.includes(status)) return status;
  }
  return 'idle';
}
