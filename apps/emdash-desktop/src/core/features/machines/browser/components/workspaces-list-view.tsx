import {
  WorkspacesList,
  type WorkspaceIconStatus,
  type WorkspacesListItem,
} from '@emdash/ui/react/components';
import { CollectionToolbar } from '@emdash/ui/react/patterns';
import { Button, RelativeTime } from '@emdash/ui/react/primitives';
import { PlusIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import type { WorkspacesScope } from '@core/features/workspaces/api/browser/use-workspace-groups';
import {
  useWorkspaceRows,
  type WorkspaceRowsGroup,
} from '@core/features/workspaces/api/browser/use-workspace-rows';
import { aggregateWorkspaceStatus } from '@core/features/workspaces/api/browser/workspace-runtime-status';
import {
  WorkspacesEmptyState,
  WorkspacesErrorState,
  WorkspacesLoadingState,
  WorkspacesOfflineState,
} from '@core/features/workspaces/contributions/browser/workspace-states';
import { useOpenModal } from '@core/manifests/browser/modal-api';

type WorkspaceEntry = {
  item: WorkspacesListItem;
};

/**
 * One row per project, rendered with the shared WorkspacesList; clicking a row
 * opens the project's workspace detail. Serves both the Local Workspaces tab
 * and the machine details Workspaces section.
 */
export const WorkspacesListView = observer(function WorkspacesListView({
  scope,
  openDetail,
  enabled = true,
}: {
  scope: WorkspacesScope;
  openDetail: (projectId: string) => void;
  /** Gates the workspace query, e.g. on remote server usability. */
  enabled?: boolean;
}) {
  const openAddProject = useOpenModal('addProjectModal');
  const workspaceRows = useWorkspaceRows({ scope, enabled });
  const { workspaceQuery, groups } = workspaceRows;
  const [search, setSearch] = useState('');
  const entries = buildWorkspaceEntries(groups);
  const filteredEntries = entries.filter((entry) => matchesSearch(entry.item, search));

  if (scope.kind === 'machine' && !enabled) {
    return (
      <WorkspacesOfflineState description="Workspaces load when the machine reconnects and its workspace server is healthy." />
    );
  }
  if (workspaceQuery.isLoading) return <WorkspacesLoadingState />;
  if (workspaceQuery.isError) return <WorkspacesErrorState error={workspaceQuery.error} />;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <CollectionToolbar
        searchValue={search}
        onSearchValueChange={setSearch}
        searchPlaceholder="Search workspaces…"
        actions={
          <Button
            type="button"
            variant="primary"
            onClick={() =>
              void openAddProject(
                scope.kind === 'machine'
                  ? { strategy: 'ssh', mode: 'clone', connectionId: scope.machineId }
                  : { strategy: 'local', mode: 'pick' }
              )
            }
          >
            <PlusIcon />
            Add Project
          </Button>
        }
      />
      <WorkspacesList
        items={filteredEntries.map((entry) => entry.item)}
        onItemClick={(item) => openDetail(item.id)}
        emptySlot={
          <WorkspacesEmptyState
            message={
              search.trim().length > 0 ? 'No workspaces match your search.' : 'No workspaces found.'
            }
          />
        }
      />
    </div>
  );
});

function matchesSearch(item: WorkspacesListItem, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return [item.name, item.path].some((value) =>
    value.toLocaleLowerCase().includes(normalizedQuery)
  );
}

function buildWorkspaceEntries(groups: readonly WorkspaceRowsGroup[]): WorkspaceEntry[] {
  return groups.map((group) => {
    const rows = group.workspaces;
    const rootRow = rows.find((joined) => joined.row.kind === 'root') ?? rows[0];
    const rowStatuses = rows.map((row) => row.status);
    const lastActivityAt = maxTimestamp(rows.map((joined) => joined.row.lastActivityAt));
    const worktreeCount = rows.filter((joined) => joined.row.kind !== 'root').length;

    return {
      item: {
        id: group.project.id,
        name: group.project.name,
        path: rootRow?.row.path ?? group.project.name,
        kind: 'repository',
        status: aggregateWorkspaceStatus(rowStatuses) satisfies WorkspaceIconStatus,
        worktreeCount,
        linkedTaskCount: rows.reduce((count, joined) => count + joined.row.tasks.length, 0),
        lastUsed: lastActivityAt ? <RelativeTime value={lastActivityAt} /> : undefined,
        activeTaskCount: rowStatuses.filter((status) => status === 'active').length,
      },
    };
  });
}

function maxTimestamp(values: readonly (string | undefined)[]): string | undefined {
  let latest: string | undefined;
  let latestTime = -Infinity;

  for (const value of values) {
    if (!value) continue;
    const time = Date.parse(value);
    if (Number.isNaN(time) || time <= latestTime) continue;
    latest = value;
    latestTime = time;
  }

  return latest;
}
