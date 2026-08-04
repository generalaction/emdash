import type { OperationDisplayState, OperationTree } from '@emdash/core/primitives/operations/api';
import {
  isTerminalStatus,
  type WorkspaceOperationRecord,
  type WorkspaceOperationRecordMap,
} from '@emdash/core/runtimes/workspace/api';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import type {
  GetProjectWorkspaceGitStatsResult,
  MeasureProjectWorkspacesResult,
  ProjectWorkspaceGitStats,
  ProjectWorkspaceRow,
  ProjectWorkspaceUsage,
} from '@core/primitives/workspaces/api';
import type {
  WorkspacePhaseKind,
  WorkspaceRuntimeStatus,
  WorkspaceRuntimeStatusDetails,
} from './use-workspace-runtime-statuses';

export type WorkspaceOperationLink = {
  node: OperationDisplayState;
  root: OperationDisplayState;
};

export type JoinedWorkspaceRow = {
  row: ProjectWorkspaceRow;
  key: string;
  status: WorkspaceRuntimeStatus;
  runtimePhase?: WorkspacePhaseKind;
  runtimeErrorMessage?: string;
  usage?: ProjectWorkspaceUsage;
  gitStats?: ProjectWorkspaceGitStats;
  operation?: WorkspaceOperationLink;
  hostOperation?: WorkspaceOperationRecord;
  operationBusy: boolean;
};

export type WorkspaceRowSources = {
  rows: readonly ProjectWorkspaceRow[];
  runtimeStatuses: ReadonlyMap<string, WorkspaceRuntimeStatusDetails>;
  usageResults?: MeasureProjectWorkspacesResult['results'];
  gitStatsResults?: GetProjectWorkspaceGitStatsResult['results'];
  operationTrees: readonly OperationTree[];
  hostOperationRecords: WorkspaceOperationRecordMap;
};

export function joinWorkspaceRows(sources: WorkspaceRowSources): JoinedWorkspaceRow[] {
  const usageByPath = successfulResultsByPath(sources.usageResults, (result) => result.usage);
  const gitStatsByPath = successfulResultsByPath(sources.gitStatsResults, (result) => result.stats);
  const operationByPath = desktopOperationByPath(sources.operationTrees);
  const hostOperationByPath = hostOperationChecklistByPath(sources.hostOperationRecords);

  return sources.rows.map((row) => {
    const runtime = row.workspaceId ? sources.runtimeStatuses.get(row.workspaceId) : undefined;
    const fallbackStatus = row.hasActiveSessions ? 'active' : 'idle';
    return {
      row,
      key: row.workspaceId ?? row.path,
      status: runtime?.status ?? fallbackStatus,
      runtimePhase: runtime?.phase,
      runtimeErrorMessage: runtime?.errorMessage,
      usage: usageByPath.get(row.path),
      gitStats: gitStatsByPath.get(row.path),
      operation: operationByPath.get(row.path),
      hostOperation: hostOperationByPath.get(row.path),
      operationBusy: operationByPath.has(row.path),
    };
  });
}

function successfulResultsByPath<TValue, TResult extends { path: string; success: boolean }>(
  results: readonly TResult[] | undefined,
  value: (result: Extract<TResult, { success: true }>) => TValue
): Map<string, TValue> {
  const byPath = new Map<string, TValue>();
  for (const result of results ?? []) {
    if (result.success)
      byPath.set(result.path, value(result as Extract<TResult, { success: true }>));
  }
  return byPath;
}

function desktopOperationByPath(
  trees: readonly OperationTree[]
): Map<string, WorkspaceOperationLink> {
  const links = new Map<string, WorkspaceOperationLink>();
  for (const tree of trees) {
    for (const node of [tree.root, ...tree.children]) {
      if (node.workspacePath) links.set(node.workspacePath, { node, root: tree.root });
    }
  }
  return links;
}

export function hostOperationChecklistByPath(
  records: WorkspaceOperationRecordMap
): Map<string, WorkspaceOperationRecord> {
  const selected = new Map<string, WorkspaceOperationRecord>();
  for (const record of Object.values(records)) {
    const terminal = isTerminalStatus(record.status);
    if (terminal && record.status !== 'failed') continue;
    const path = nativePathFromHost(record.workspace.path);
    const existing = selected.get(path);
    if (!existing || shouldReplaceHostOperation(existing, record)) selected.set(path, record);
  }
  return selected;
}

function shouldReplaceHostOperation(
  existing: WorkspaceOperationRecord,
  candidate: WorkspaceOperationRecord
): boolean {
  const existingTerminal = isTerminalStatus(existing.status);
  const candidateTerminal = isTerminalStatus(candidate.status);
  if (existingTerminal !== candidateTerminal) return existingTerminal;
  return candidate.updatedAt > existing.updatedAt;
}
