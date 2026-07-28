import {
  WorkspaceDetailView,
  WorkspacesList,
  type WorkspaceIconStatus,
  type WorkspacesListItem,
} from '@emdash/ui/react/components';
import { useQueryClient } from '@tanstack/react-query';
import { observer } from 'mobx-react-lite';
import { useCallback, useMemo, useState } from 'react';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { RelativeTime } from '@core/primitives/ui/browser/relative-time';
import { Spinner } from '@core/primitives/ui/browser/spinner';
import { toast } from '@core/primitives/ui/browser/use-toast';
import type { ProjectWorkspaceRow } from '@core/primitives/workspaces/api';
import {
  deleteMachineProjectWorkspaces,
  useLocalWorkspaces,
  type MachineProjectWorkspaces,
} from '../use-machine-workspaces';
import { useWorkspaceRuntimeStatuses } from '../use-workspace-runtime-statuses';
import { aggregateWorkspaceStatus, workspaceStatus } from '../workspace-runtime-status';

type LocalWorkspaceEntry = {
  group: MachineProjectWorkspaces;
  item: WorkspacesListItem;
  rootRow: ProjectWorkspaceRow | undefined;
};

const EMPTY_WORKSPACE_GROUPS: MachineProjectWorkspaces[] = [];

export const LocalWorkspacesView = observer(function LocalWorkspacesView() {
  const queryClient = useQueryClient();
  const openConfirm = useOpenModal('confirmActionModal');
  const workspaceQuery = useLocalWorkspaces(true);
  const groups = workspaceQuery.data ?? EMPTY_WORKSPACE_GROUPS;
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const statusInputs = useMemo(
    () =>
      groups.flatMap((group) =>
        group.workspaces.map((row) => ({
          workspaceId: row.workspaceId,
          hasActiveSessions: row.hasActiveSessions,
        }))
      ),
    [groups]
  );
  const statuses = useWorkspaceRuntimeStatuses(statusInputs);
  const entries = buildLocalWorkspaceEntries(groups, statuses);
  const selectedEntry = entries.find((entry) => entry.item.id === selectedProjectId);

  const handleDelete = useCallback(
    async (entry: LocalWorkspaceEntry) => {
      const deletableRows = entry.group.workspaces.filter((row) => row.canDelete);
      if (deletableRows.length === 0) {
        toast({
          title: 'No deletable workspaces',
          description: 'Repository roots cannot be deleted from this view.',
        });
        return;
      }

      const outcome = await openConfirm({
        title: `Delete ${entry.item.name} workspaces?`,
        description:
          'This deletes linked task worktrees for this repository where supported. Repository roots are preserved.',
        confirmLabel: 'Delete',
        variant: 'destructive',
      });

      if (!outcome.success) return;

      try {
        const result = await deleteMachineProjectWorkspaces({
          projectId: entry.group.project.id,
          paths: deletableRows.map((row) => row.path),
        });
        const failed = result.results.filter((row) => !row.success);

        if (failed.length > 0) {
          toast({
            title: `${result.results.length - failed.length} deleted, ${failed.length} failed`,
            description: failed[0]?.message,
            variant: 'destructive',
          });
        } else {
          toast({ title: `Deleted ${deletableRows.length} workspaces` });
          setSelectedProjectId(null);
        }

        await queryClient.invalidateQueries({ queryKey: ['machineWorkspaces', 'local'] });
      } catch (error) {
        toast({
          title: 'Could not delete workspaces',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        });
      }
    },
    [openConfirm, queryClient]
  );

  if (workspaceQuery.isLoading) return <LocalWorkspacesLoadingState />;
  if (workspaceQuery.isError) return <LocalWorkspacesErrorState error={workspaceQuery.error} />;

  if (selectedEntry) {
    return (
      <WorkspaceDetailView
        name={selectedEntry.item.name}
        path={selectedEntry.item.path}
        kind={selectedEntry.item.kind}
        status={selectedEntry.item.status}
        branch={selectedEntry.rootRow?.branch}
        worktreeCount={selectedEntry.item.worktreeCount ?? 0}
        linkedTaskCount={selectedEntry.item.linkedTaskCount}
        onBack={() => setSelectedProjectId(null)}
        onDelete={() => void handleDelete(selectedEntry)}
        worktreesSlot="Worktrees placeholder content."
        tasksSlot="Tasks placeholder content."
      />
    );
  }

  return (
    <div className="min-h-0">
      <WorkspacesList
        items={entries.map((entry) => entry.item)}
        onItemClick={(item) => setSelectedProjectId(item.id)}
        emptySlot={<LocalWorkspacesEmptyState />}
      />
    </div>
  );
});

function buildLocalWorkspaceEntries(
  groups: readonly MachineProjectWorkspaces[],
  statuses: Parameters<typeof workspaceStatus>[1]
): LocalWorkspaceEntry[] {
  return groups.map((group) => {
    const rows = group.workspaces;
    const rootRow = rows.find((row) => row.kind === 'root') ?? rows[0];
    const rowStatuses = rows.map((row) => workspaceStatus(row, statuses));
    const lastActivityAt = maxTimestamp(rows.map((row) => row.lastActivityAt));
    const worktreeCount = rows.filter((row) => row.kind !== 'root').length;

    return {
      group,
      rootRow,
      item: {
        id: group.project.id,
        name: group.project.name,
        path: rootRow?.path ?? group.project.name,
        kind: 'repository',
        status: aggregateWorkspaceStatus(rowStatuses) satisfies WorkspaceIconStatus,
        worktreeCount,
        linkedTaskCount: rows.reduce((count, row) => count + row.tasks.length, 0),
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

function LocalWorkspacesLoadingState() {
  return (
    <div className="flex h-40 items-center justify-center gap-2 text-sm text-foreground-muted">
      <Spinner className="size-4" />
      Loading workspaces
    </div>
  );
}

function LocalWorkspacesErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-1 text-sm">
      <div className="text-foreground-destructive">Could not load workspaces.</div>
      <div className="max-w-md text-center text-xs text-foreground-muted">{message}</div>
    </div>
  );
}

function LocalWorkspacesEmptyState() {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-foreground-muted">
      No workspaces found.
    </div>
  );
}
