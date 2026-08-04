import type { OperationDisplayState, OperationTree } from '@emdash/core/primitives/operations/api';
import type {
  GetProjectWorkspaceGitStatsResult,
  MeasureProjectWorkspacesResult,
  ProjectWorkspaceGitStats,
  ProjectWorkspaceRow,
  ProjectWorkspaceUsage,
} from '@core/primitives/workspaces/api';
import type { WorkspaceRuntimeStatus } from './workspace-runtime-status';

export type WorkspaceOperationLink = {
  node: OperationDisplayState;
  root: OperationDisplayState;
};

export type JoinedWorkspaceRow = {
  row: ProjectWorkspaceRow;
  key: string;
  status: WorkspaceRuntimeStatus;
  operationErrorMessage?: string;
  usage?: ProjectWorkspaceUsage;
  gitStats?: ProjectWorkspaceGitStats;
  operation?: WorkspaceOperationLink;
  operationBusy: boolean;
};

export type WorkspaceRowSources = {
  rows: readonly ProjectWorkspaceRow[];
  usageResults?: MeasureProjectWorkspacesResult['results'];
  gitStatsResults?: GetProjectWorkspaceGitStatsResult['results'];
  operationTrees: readonly OperationTree[];
};

export function joinWorkspaceRows(sources: WorkspaceRowSources): JoinedWorkspaceRow[] {
  const usageByPath = successfulResultsByPath(sources.usageResults, (result) => result.usage);
  const gitStatsByPath = successfulResultsByPath(sources.gitStatsResults, (result) => result.stats);
  const operationByPath = desktopOperationByPath(sources.operationTrees);

  return sources.rows.map((row) => {
    const operation = operationByPath.get(row.path);
    return {
      row,
      key: row.workspaceId ?? row.path,
      status: workspaceRowStatus(row, operation),
      operationErrorMessage: operation?.node.status === 'failed' ? operation.node.error : undefined,
      usage: usageByPath.get(row.path),
      gitStats: gitStatsByPath.get(row.path),
      operation,
      operationBusy: operation !== undefined && !isSettledOperation(operation.node),
    };
  });
}

/**
 * Session activity is the baseline; a live kernel operation touching the
 * workspace path refines it into setting-up / tearing-down / error.
 */
function workspaceRowStatus(
  row: ProjectWorkspaceRow,
  operation: WorkspaceOperationLink | undefined
): WorkspaceRuntimeStatus {
  const fallback = row.hasActiveSessions ? 'active' : 'idle';
  if (!operation) return fallback;
  const node = operation.node;
  if (node.status === 'failed') return 'error';
  if (isSettledOperation(node)) return fallback;
  return isRemovalOperation(node) ? 'tearing-down' : 'setting-up';
}

function isSettledOperation(node: OperationDisplayState): boolean {
  return node.status === 'succeeded';
}

function isRemovalOperation(node: OperationDisplayState): boolean {
  // Covers host-remove-worktree plus the delete-task / delete-project /
  // archive-task desktop operations that carry a workspacePath.
  return (
    node.operationKind.includes('remove') ||
    node.operationKind.includes('delete') ||
    node.operationKind.includes('archive')
  );
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
