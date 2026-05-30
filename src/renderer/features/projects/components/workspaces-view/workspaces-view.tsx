import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { PageHeader } from '@renderer/lib/components/page-header';
import { rpc } from '@renderer/lib/ipc';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@renderer/lib/ui/alert';
import { Button } from '@renderer/lib/ui/button';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { Spinner } from '@renderer/lib/ui/spinner';
import { cn } from '@renderer/utils/utils';
import { WorkspaceRow, type FlatItem, INSTANCE_ROW_HEIGHT } from './workspace-row';

export function WorkspacesView() {
  const {
    params: { projectId },
  } = useParams('project');

  const queryClient = useQueryClient();
  const [expandedHosts, setExpandedHosts] = useState<Record<string, boolean>>({});
  const [expandedInstances, setExpandedInstances] = useState<Record<string, boolean>>({
    primary: true,
  });
  const [search, setSearch] = useState('');
  const parentRef = useRef<HTMLDivElement>(null);

  const showAddRepoInstanceModal = useShowModal('addRepoInstanceModal');

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

  const { data: instances, isPending: instancesPending } = useQuery({
    queryKey: ['listRepoInstances', projectId],
    queryFn: () => rpc.projects.listRepoInstances(projectId),
    enabled: !!projectId,
  });

  const { data: sshConnections } = useQuery({
    queryKey: ['sshConnections'],
    queryFn: () => rpc.ssh.getConnections(),
    staleTime: Infinity,
  });

  const connectionNameMap = useMemo(
    () => Object.fromEntries((sshConnections ?? []).map((c) => [c.id, c.name])),
    [sshConnections]
  );

  const instanceWorktreeResults = useQueries({
    queries: (instances ?? []).map((inst) => ({
      queryKey: ['listWorktreesForInstance', projectId, inst.id],
      queryFn: () => rpc.projects.listWorktreesForInstance(projectId, inst.id),
      enabled: !!inst.path,
      refetchOnWindowFocus: true,
    })),
  });

  const instanceWorktreeMap = useMemo<Record<string, typeof instanceWorktreeResults[number]['data']>>(
    () => {
      const map: Record<string, typeof instanceWorktreeResults[number]['data']> = {};
      for (let i = 0; i < (instances ?? []).length; i++) {
        const inst = instances![i]!;
        map[inst.id] = instanceWorktreeResults[i]?.data;
      }
      return map;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instances, instanceWorktreeResults]
  );

  const instanceWorktreesPending = instanceWorktreeResults.some((r) => r.isPending);

  const linkedEntries = useMemo(() => entries?.filter((e) => !e.isMain) ?? [], [entries]);

  const { data: worktreeStatuses } = useQuery({
    queryKey: ['worktreeStatuses', projectId, linkedEntries.map((e) => e.path)],
    queryFn: () =>
      rpc.projects.getWorktreeStatuses(
        projectId,
        linkedEntries.map((e) => e.path)
      ),
    enabled: !!projectId && linkedEntries.length > 0,
  });

  const isPending = worktreesPending || instancesPending || instanceWorktreesPending;
  const isError = worktreesError;
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
        (e) => (taskCounts?.[e.path] ?? 0) === 0 && !(worktreeStatuses?.[e.path] ?? false)
      ),
    [linkedEntries, taskCounts, worktreeStatuses]
  );

  const toggleHost = (key: string) => {
    setExpandedHosts((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  };

  const toggleInstance = (key: string) => {
    setExpandedInstances((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const primaryInstance = useMemo(
    () => ({
      id: 'primary',
      projectId,
      label: null,
      kind: 'local' as const,
      connectionId: null,
      path: mainEntry?.path ?? '',
      remoteUrl: null,
      isFork: false,
      isPrimary: true,
      createdAt: '',
      updatedAt: '',
    }),
    [projectId, mainEntry?.path]
  );

  const flatItems = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = [];
    const q = search.trim().toLowerCase();

    // --- Build host groups ---
    // Local host: primary + all local secondary instances
    const localInstances = [
      { inst: primaryInstance, isPrimary: true },
      ...(instances ?? [])
        .filter((i) => i.kind === 'local')
        .map((i) => ({ inst: i, isPrimary: false })),
    ];

    // SSH hosts: one group per unique connectionId
    const sshGroups = new Map<string, typeof instances>();
    for (const inst of instances ?? []) {
      if (inst.kind === 'ssh' && inst.connectionId) {
        const existing = sshGroups.get(inst.connectionId) ?? [];
        sshGroups.set(inst.connectionId, [...existing, inst]);
      }
    }

    // --- Emit local host ---
    const localHostKey = 'local';
    const localHostExpanded = expandedHosts[localHostKey] ?? true;

    items.push({
      type: 'host',
      hostKey: localHostKey,
      label: 'This machine',
      username: systemInfo?.hostname ?? '',
      kind: 'local',
      isExpanded: localHostExpanded,
    });

    if (localHostExpanded) {
      for (const { inst, isPrimary } of localInstances) {
        const instanceKey = isPrimary ? 'primary' : inst.id;
        const isExpanded = expandedInstances[instanceKey] ?? true;
        const effectivelyExpanded = isExpanded || q.length > 0;

        if (isPrimary) {
          const primaryPath = mainEntry?.path ?? '';
          const primaryRepoName = primaryPath.split('/').filter(Boolean).at(-1) ?? '';

          items.push({
            type: 'instance-header',
            instance: inst,
            isPrimary: true,
            isExpanded: effectivelyExpanded,
            worktreeCount: linkedEntries.length,
            taskCount: taskCounts?.[primaryPath] ?? 0,
            mainEntry,
            projectId,
            depth: 1,
          });

          if (effectivelyExpanded) {
            for (const entry of filteredLinkedEntries) {
              items.push({
                type: 'worktree',
                entry,
                instanceId: 'primary',
                taskCount: taskCounts?.[entry.path] ?? 0,
                repoName: primaryRepoName,
                hasUncommittedChanges: worktreeStatuses?.[entry.path] ?? false,
                projectId,
              });
            }
          }
        } else {
          const allWorktrees = instanceWorktreeMap[inst.id] ?? [];
          const instanceMainEntry = allWorktrees.find((e) => e.isMain);
          const instanceLinkedWorktrees = allWorktrees.filter((e) => !e.isMain);
          const filteredWorktrees = q
            ? instanceLinkedWorktrees.filter(
                (e) =>
                  e.path.toLowerCase().includes(q) || (e.branch?.toLowerCase().includes(q) ?? false)
              )
            : instanceLinkedWorktrees;
          const instanceRepoName = inst.path?.split('/').filter(Boolean).at(-1) ?? '';

          items.push({
            type: 'instance-header',
            instance: inst,
            isPrimary: false,
            isExpanded: effectivelyExpanded,
            worktreeCount: instanceLinkedWorktrees.length,
            taskCount: taskCounts?.[inst.path ?? ''] ?? 0,
            mainEntry: instanceMainEntry,
            projectId,
            depth: 1,
          });

          if (effectivelyExpanded) {
            for (const entry of filteredWorktrees) {
              items.push({
                type: 'worktree',
                entry,
                instanceId: inst.id,
                taskCount: taskCounts?.[entry.path] ?? 0,
                repoName: instanceRepoName,
                hasUncommittedChanges: false,
                projectId,
              });
            }
          }
        }
      }
    }

    // --- Emit SSH host groups ---
    for (const [connectionId, sshInstances] of sshGroups) {
      const hostKey = connectionId;
      const hostExpanded = expandedHosts[hostKey] ?? true;
      const connectionName = connectionNameMap[connectionId] ?? connectionId;

      items.push({
        type: 'host',
        hostKey,
        label: connectionName,
        connectionId,
        kind: 'ssh',
        isExpanded: hostExpanded,
      });

      if (hostExpanded) {
        for (const inst of sshInstances ?? []) {
          const instanceKey = inst.id;
          const isExpanded = expandedInstances[instanceKey] ?? true;
          const effectivelyExpanded = isExpanded || q.length > 0;

          const allWorktrees = instanceWorktreeMap[inst.id] ?? [];
          const instanceMainEntry = allWorktrees.find((e) => e.isMain);
          const instanceLinkedWorktrees = allWorktrees.filter((e) => !e.isMain);
          const filteredWorktrees = q
            ? instanceLinkedWorktrees.filter(
                (e) =>
                  e.path.toLowerCase().includes(q) || (e.branch?.toLowerCase().includes(q) ?? false)
              )
            : instanceLinkedWorktrees;
          const instanceRepoName = inst.path?.split('/').filter(Boolean).at(-1) ?? '';

          items.push({
            type: 'instance-header',
            instance: inst,
            isPrimary: false,
            isExpanded: effectivelyExpanded,
            worktreeCount: instanceLinkedWorktrees.length,
            taskCount: taskCounts?.[inst.path ?? ''] ?? 0,
            mainEntry: instanceMainEntry,
            projectId,
            depth: 1,
          });

          if (effectivelyExpanded) {
            for (const entry of filteredWorktrees) {
              items.push({
                type: 'worktree',
                entry,
                instanceId: inst.id,
                taskCount: taskCounts?.[entry.path] ?? 0,
                repoName: instanceRepoName,
                hasUncommittedChanges: false,
                projectId,
              });
            }
          }
        }
      }
    }

    return items;
  }, [
    search,
    primaryInstance,
    instances,
    expandedHosts,
    expandedInstances,
    mainEntry,
    linkedEntries,
    filteredLinkedEntries,
    instanceWorktreeMap,
    taskCounts,
    worktreeStatuses,
    projectId,
    connectionNameMap,
    systemInfo,
  ]);

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => INSTANCE_ROW_HEIGHT,
    overscan: 8,
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['listWorktrees', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['workspaceTaskCounts', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['worktreeStatuses', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['listRepoInstances', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['listWorktreesForInstance', projectId] });
  };

  const { mutate: removeWorktree, isPending: isRemoving } = useMutation({
    mutationFn: (worktreePath: string) => rpc.projects.removeWorktree(projectId, worktreePath),
    onSettled: () => invalidateAll(),
  });

  const { mutate: removeInstance } = useMutation({
    mutationFn: (instanceId: string) => rpc.projects.removeRepoInstance(projectId, instanceId),
    onSettled: () => invalidateAll(),
  });

  const handleRemoveCleanable = () => {
    for (const entry of cleanableWorktrees) {
      removeWorktree(entry.path);
    }
  };

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col">
      <div className="shrink-0">
        <PageHeader
          title="Workspaces"
          description="Manage repositories and worktrees related to this project"
        >
          {!isPending && !isError && cleanableWorktrees.length > 0 && (
            <Alert variant="warning">
              <AlertTitle>
                <Trash2 />
                Cleanable worktrees
              </AlertTitle>
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
                onClick={() => invalidateAll()}
                disabled={isPending}
                aria-label="Refresh"
              >
                <RefreshCw className={cn('size-4', isPending && 'animate-spin')} />
              </Button>
            </div>
            <Button
              size="sm"
              onClick={() =>
                showAddRepoInstanceModal({
                  projectId,
                  onSuccess: () => invalidateAll(),
                  onClose: () => {},
                })
              }
            >
              <Plus className="size-4" />
              Add repository
            </Button>
          </div>
        </PageHeader>
      </div>

      {isPending && (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      )}

      {isError && (
        <p className="py-4 text-sm text-foreground-destructive">Failed to load worktrees.</p>
      )}

      {!isPending && !isError && flatItems.length > 0 && (
        <div
          ref={parentRef}
          className="min-h-0 flex-1 overflow-y-auto py-4"
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
                    onToggle={() => {
                      if (item.type === 'host') {
                        toggleHost(item.hostKey);
                      } else if (item.type === 'instance-header') {
                        toggleInstance(item.isPrimary ? 'primary' : item.instance.id);
                      }
                    }}
                    onRemove={
                      item.type === 'worktree'
                        ? () => removeWorktree(item.entry.path)
                        : item.type === 'instance-header' && !item.isPrimary
                          ? () => removeInstance(item.instance.id)
                          : undefined
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!isPending &&
        !isError &&
        (expandedHosts['local'] ?? true) &&
        (expandedInstances['primary'] ?? true) &&
        filteredLinkedEntries.length === 0 &&
        mainEntry && (
          <p className="px-8 py-3 text-sm text-foreground-muted">
            No worktrees yet. Create a task with a branch to add one.
          </p>
        )}
    </div>
  );
}
