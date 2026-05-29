import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { RefreshCw, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { PageHeader } from '@renderer/lib/components/page-header';
import { rpc } from '@renderer/lib/ipc';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@renderer/lib/ui/alert';
import { Button } from '@renderer/lib/ui/button';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { Spinner } from '@renderer/lib/ui/spinner';
import { cn } from '@renderer/utils/utils';
import { WorkspaceRow, type FlatItem, ROW_HEIGHT } from './workspace-row';

export function WorkspacesView() {
  const {
    params: { projectId },
  } = useParams('project');

  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(true);
  const [search, setSearch] = useState('');
  const parentRef = useRef<HTMLDivElement>(null);

  const {
    data: entries,
    isPending: worktreesPending,
    isError: worktreesError,
  } = useQuery({
    queryKey: ['listWorktrees', projectId],
    queryFn: () => rpc.projects.listWorktrees(projectId),
    refetchOnWindowFocus: true,
    enabled: !!projectId,
  });

  const { data: systemInfo } = useQuery({
    queryKey: ['systemInfo'],
    queryFn: () => rpc.app.getSystemInfo(),
    staleTime: Infinity,
  });

  const { data: taskCounts } = useQuery({
    queryKey: ['workspaceTaskCounts', projectId],
    queryFn: () => rpc.projects.getWorkspaceTaskCounts(projectId),
    enabled: !!projectId,
  });

  const linkedEntries = useMemo(() => entries?.filter((e) => !e.isMain) ?? [], [entries]);

  const { data: worktreeStatuses } = useQuery({
    queryKey: ['worktreeStatuses', projectId, linkedEntries.map((e) => e.path)],
    queryFn: () => rpc.projects.getWorktreeStatuses(projectId, linkedEntries.map((e) => e.path)),
    enabled: !!projectId && linkedEntries.length > 0,
  });

  const isPending = worktreesPending;
  const isError = worktreesError;
  const username = systemInfo?.username ?? '';

  const mainEntry = useMemo(() => entries?.find((e) => e.isMain), [entries]);

  const filteredLinkedEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return linkedEntries;
    return linkedEntries.filter(
      (e) => e.path.toLowerCase().includes(q) || (e.branch?.toLowerCase().includes(q) ?? false)
    );
  }, [linkedEntries, search]);

  const cleanableWorktrees = useMemo(
    () =>
      linkedEntries.filter(
        (e) =>
          (taskCounts?.[e.path] ?? 0) === 0 && !(worktreeStatuses?.[e.path] ?? false)
      ),
    [linkedEntries, taskCounts, worktreeStatuses]
  );

  // Auto-expand when searching so results are always visible.
  const effectivelyExpanded = isExpanded || search.trim().length > 0;

  const flatItems = useMemo<FlatItem[]>(() => {
    if (!mainEntry) return [];

    const items: FlatItem[] = [
      {
        type: 'main',
        entry: mainEntry,
        isExpanded: effectivelyExpanded,
        worktreeCount: linkedEntries.length,
        taskCount: taskCounts?.[mainEntry.path] ?? 0,
        username,
        projectId,
      },
    ];

    const repoName = mainEntry.path.split('/').filter(Boolean).at(-1) ?? '';

    if (effectivelyExpanded) {
      for (const entry of filteredLinkedEntries) {
        items.push({
          type: 'worktree',
          entry,
          taskCount: taskCounts?.[entry.path] ?? 0,
          repoName,
          hasUncommittedChanges: worktreeStatuses?.[entry.path] ?? false,
          projectId,
        });
      }
    }

    return items;
  }, [
    mainEntry,
    effectivelyExpanded,
    filteredLinkedEntries,
    linkedEntries.length,
    taskCounts,
    worktreeStatuses,
    username,
    projectId,
  ]);

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['listWorktrees', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['workspaceTaskCounts', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['worktreeStatuses', projectId] });
  };

  const handleRefresh = () => {
    invalidateAll();
  };

  const { mutate: removeWorktree, isPending: isRemoving } = useMutation({
    mutationFn: (worktreePath: string) => rpc.projects.removeWorktree(projectId, worktreePath),
    onSettled: () => invalidateAll(),
  });

  const handleRemoveCleanable = () => {
    for (const entry of cleanableWorktrees) {
      removeWorktree(entry.path);
    }
  };

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col">
      {/* Header with search */}
      <div className="shrink-0">
        <PageHeader title="Workspaces" description="Manage your projects workspaces">
            {/* Cleanable worktrees alert */}
            {!isPending && !isError && cleanableWorktrees.length > 0 && (
                <Alert variant="warning">
                  <AlertTitle><Trash2 />Cleanable worktrees</AlertTitle>
                  <AlertDescription>
                    You have {cleanableWorktrees.length}{' '}
                    {cleanableWorktrees.length === 1 ? 'worktree' : 'worktrees'} that can be cleaned up
                    because {cleanableWorktrees.length === 1 ? 'it has' : 'they have'} no uncommitted
                    changes and no associated task in emdash.
                  </AlertDescription>
                  <AlertAction onClick={handleRemoveCleanable} disabled={isRemoving}>
                    Remove worktrees
                  </AlertAction>
                </Alert>
            )}
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-2">
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search worktrees…"
              className="flex-1"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isPending}
              aria-label="Refresh"
            >
              <RefreshCw className={cn('size-4', isPending && 'animate-spin')} />
            </Button>
            </div>
            <Button>
              Add Workspace
            </Button>
          </div>
        </PageHeader>
      </div>


      {/* Loading */}
      {isPending && (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      )}

      {/* Error */}
      {isError && (
        <p className="py-4 text-sm text-foreground-destructive">Failed to load worktrees.</p>
      )}

      {/* Virtual list — main repo row + worktree rows */}
      {!isPending && !isError && flatItems.length > 0 && (
        <div
          ref={parentRef}
          className="min-h-0 flex-1 overflow-y-auto"
          style={{ scrollbarWidth: 'none' }}
        >
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vItem) => {
              const item = flatItems[vItem.index]!;
              return (
                <div
                  key={vItem.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vItem.start}px)`,
                  }}
                >
                  <WorkspaceRow
                    item={item}
                    onToggle={() => setIsExpanded((v) => !v)}
                    onRemove={
                      item.type === 'worktree'
                        ? () => removeWorktree(item.entry.path)
                        : undefined
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state — outside the virtualizer */}
      {!isPending &&
        !isError &&
        effectivelyExpanded &&
        filteredLinkedEntries.length === 0 &&
        mainEntry && (
          <p className="px-8 py-3 text-sm text-foreground-muted">
            No worktrees yet. Create a task with a branch to add one.
          </p>
        )}
    </div>
  );
}
