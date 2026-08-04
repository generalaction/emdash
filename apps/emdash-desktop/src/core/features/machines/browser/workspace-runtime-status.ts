import type { ProjectWorkspaceRow } from '@core/primitives/workspaces/api';
import type {
  WorkspacePhaseKind,
  WorkspaceRuntimeStatus,
  WorkspaceRuntimeStatusDetails,
} from './use-workspace-runtime-statuses';

const STATUS_PRIORITY: WorkspaceRuntimeStatus[] = [
  'error',
  'tearing-down',
  'setting-up',
  'active',
  'idle',
];

export function workspaceStatus(
  row: ProjectWorkspaceRow,
  statuses: ReadonlyMap<string, WorkspaceRuntimeStatusDetails>
): WorkspaceRuntimeStatus {
  if (!row.workspaceId) return row.hasActiveSessions ? 'active' : 'idle';
  return statuses.get(row.workspaceId)?.status ?? (row.hasActiveSessions ? 'active' : 'idle');
}

export function workspacePhase(
  row: ProjectWorkspaceRow,
  statuses: ReadonlyMap<string, WorkspaceRuntimeStatusDetails>
): WorkspacePhaseKind | undefined {
  if (!row.workspaceId) return undefined;
  return statuses.get(row.workspaceId)?.phase;
}

export function workspaceRuntimeErrorMessage(
  row: ProjectWorkspaceRow,
  statuses: ReadonlyMap<string, WorkspaceRuntimeStatusDetails>
): string | undefined {
  if (!row.workspaceId) return undefined;
  return statuses.get(row.workspaceId)?.errorMessage;
}

export function aggregateWorkspaceStatus(
  statuses: readonly WorkspaceRuntimeStatus[]
): WorkspaceRuntimeStatus {
  for (const status of STATUS_PRIORITY) {
    if (statuses.includes(status)) return status;
  }
  return 'idle';
}

export function workspacePhaseLabel(phase: WorkspacePhaseKind): string {
  switch (phase) {
    case 'unprovisioned':
      return 'Not provisioned';
    case 'provisioning':
      return 'Provisioning';
    case 'provisioned':
      return 'Provisioned';
    case 'active':
      return 'Active';
    case 'activating':
      return 'Activating';
    case 'ready':
      return 'Ready';
    case 'deactivating':
      return 'Deactivating';
    case 'tearing-down':
      return 'Tearing down';
    case 'cleaning':
      return 'Cleaning artifacts';
    case 'broken':
      return 'Broken';
  }
}
