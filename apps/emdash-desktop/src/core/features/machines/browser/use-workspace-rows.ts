import { useMemo } from 'react';
import { useOperationTrees } from '@core/services/operations/browser/use-operation-trees';
import {
  getMachineOperationsClient,
  useLocalWorkspaces,
  useProjectWorkspaceGitStats,
  useProjectWorkspaceUsage,
} from './use-machine-workspaces';
import { joinWorkspaceRows, type JoinedWorkspaceRow } from './workspace-rows';

export type WorkspaceRowsScope = {
  projectId?: string;
  enabled: boolean;
};

const EMPTY_GROUPS: never[] = [];

export function useWorkspaceRows(scope: WorkspaceRowsScope) {
  const workspaceQuery = useLocalWorkspaces(scope.enabled);
  const sourceGroups = workspaceQuery.data ?? EMPTY_GROUPS;
  const sourceGroup = scope.projectId
    ? sourceGroups.find((group) => group.project.id === scope.projectId)
    : undefined;
  const sourceRows = useMemo(
    () =>
      scope.projectId
        ? (sourceGroup?.workspaces ?? [])
        : sourceGroups.flatMap((group) => group.workspaces),
    [scope.projectId, sourceGroup, sourceGroups]
  );
  const measuredPaths = useMemo(
    () => sourceRows.filter((row) => row.pathState === 'measured').map((row) => row.path),
    [sourceRows]
  );
  const usageQuery = useProjectWorkspaceUsage(
    scope.projectId,
    measuredPaths,
    scope.enabled && !!scope.projectId && sourceRows.length > 0
  );
  const gitStatsQuery = useProjectWorkspaceGitStats(
    scope.projectId,
    measuredPaths,
    scope.enabled && !!scope.projectId && sourceRows.length > 0
  );
  const operationTrees = useOperationTrees(scope.projectId ?? '', getMachineOperationsClient);
  const joinedRows = useMemo(
    () =>
      joinWorkspaceRows({
        rows: sourceRows,
        usageResults: usageQuery.data?.results,
        gitStatsResults: gitStatsQuery.data?.results,
        operationTrees: operationTrees.trees,
      }),
    [sourceRows, usageQuery.data?.results, gitStatsQuery.data?.results, operationTrees.trees]
  );
  const rowsBySource = useMemo(
    () => new Map(joinedRows.map((row) => [sourceKey(row), row])),
    [joinedRows]
  );
  const groups = useMemo(
    () =>
      sourceGroups.map((group) => ({
        project: group.project,
        warnings: group.warnings,
        workspaces: group.workspaces.flatMap((row) => {
          const joined = rowsBySource.get(`${row.projectId}\0${row.workspaceId ?? row.path}`);
          return joined ? [joined] : [];
        }),
      })),
    [rowsBySource, sourceGroups]
  );
  const group = scope.projectId
    ? groups.find((candidate) => candidate.project.id === scope.projectId)
    : undefined;

  return {
    workspaceQuery,
    groups,
    group,
    rows: joinedRows,
    operationTrees,
    usageQuery,
    gitStatsQuery,
  };
}

export type WorkspaceRowsResult = ReturnType<typeof useWorkspaceRows>;
export type WorkspaceRowsGroup = WorkspaceRowsResult['groups'][number];

function sourceKey(joined: JoinedWorkspaceRow): string {
  return `${joined.row.projectId}\0${joined.key}`;
}
