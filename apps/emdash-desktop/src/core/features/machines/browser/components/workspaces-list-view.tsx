import {
  WorkspacesList,
  type WorkspaceIconStatus,
  type WorkspacesListItem,
} from '@emdash/ui/react/components';
import { Button, SearchInput } from '@emdash/ui/react/primitives';
import { PlusIcon, WifiOffIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { RelativeTime } from '@core/primitives/ui/browser/relative-time';
import { Spinner } from '@core/primitives/ui/browser/spinner';
import {
  useWorkspaceRows,
  type WorkspaceRowsGroup,
  type WorkspacesScope,
} from '../use-workspace-rows';
import { aggregateWorkspaceStatus } from '../workspace-runtime-status';

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

  if (scope.kind === 'machine' && !enabled) return <WorkspacesOfflineState />;
  if (workspaceQuery.isLoading) return <WorkspacesLoadingState />;
  if (workspaceQuery.isError) return <WorkspacesErrorState error={workspaceQuery.error} />;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <SearchInput
          size="sm"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClear={() => setSearch('')}
          placeholder="Search workspaces…"
          style={{ width: '14rem' }}
        />
        <Button
          type="button"
          variant="primary"
          size="sm"
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
      </div>
      <WorkspacesList
        items={filteredEntries.map((entry) => entry.item)}
        onItemClick={(item) => openDetail(item.id)}
        emptySlot={<WorkspacesEmptyState searching={search.trim().length > 0} />}
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

function WorkspacesLoadingState() {
  return (
    <div className="flex h-40 items-center justify-center gap-2 text-sm text-foreground-muted">
      <Spinner className="size-4" />
      Loading workspaces
    </div>
  );
}

function WorkspacesErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-1 text-sm">
      <div className="text-foreground-destructive">Could not load workspaces.</div>
      <div className="max-w-md text-center text-xs text-foreground-muted">{message}</div>
    </div>
  );
}

function WorkspacesOfflineState() {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-1 text-sm text-foreground-muted">
      <div className="inline-flex items-center gap-2">
        <WifiOffIcon className="size-4" />
        Machine offline
      </div>
      <p className="max-w-sm text-center text-xs text-foreground-passive">
        Workspaces load when the machine reconnects and its workspace server is healthy.
      </p>
    </div>
  );
}

function WorkspacesEmptyState({ searching }: { searching: boolean }) {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-foreground-muted">
      {searching ? 'No workspaces match your search.' : 'No workspaces found.'}
    </div>
  );
}
