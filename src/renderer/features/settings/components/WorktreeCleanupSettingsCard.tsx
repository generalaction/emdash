import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderIcon, RefreshCw, Trash2 } from 'lucide-react';
import React from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { events, rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { AnimatedHeight } from '@renderer/lib/ui/animated-height';
import { Button } from '@renderer/lib/ui/button';
import { Switch } from '@renderer/lib/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { formatBytes } from '@renderer/utils/formatBytes';
import { cn } from '@renderer/utils/utils';
import {
  managedWorktreeRefreshCompleteChannel,
  managedWorktreeSizeUpdatedChannel,
} from '@shared/events/worktree-events';
import { dirnameFromAnyPath } from '@shared/path-name';
import {
  WORKTREE_CLEANUP_INTERVAL_MS,
  type ManagedWorktreesSummary,
} from '@shared/worktree-cleanup';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';
import { SettingsNumberStepper } from './SettingsNumberStepper';

type ManagedWorktree = ManagedWorktreesSummary['worktrees'][number];

type WorktreeGroup = {
  key: string;
  label: string;
  path: string | null;
  worktrees: ManagedWorktree[];
  totalSizeBytes: number;
};

const managedWorktreesQueryKey = ['managedWorktrees'] as const;

function formatCleanupInterval(ms: number): string {
  const minutes = ms / (60 * 1000);
  if (Number.isInteger(minutes) && minutes < 60) {
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }

  const hours = ms / (60 * 60 * 1000);
  if (Number.isInteger(hours)) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }

  return `${Math.round(minutes)} minutes`;
}

function groupWorktreesByProject(worktrees: ManagedWorktree[]): WorktreeGroup[] {
  const groups = new Map<string, WorktreeGroup>();

  for (const worktree of worktrees) {
    const key = worktree.projectId
      ? `id:${worktree.projectId}`
      : worktree.projectName
        ? `name:${worktree.projectName}`
        : 'unknown-project';
    const label = worktree.projectName ?? 'Unknown project';
    const groupPath = dirnameFromAnyPath(worktree.path);
    const existing = groups.get(key);

    if (existing) {
      existing.worktrees.push(worktree);
      existing.totalSizeBytes += worktree.sizeBytes;
      if (!existing.path) existing.path = groupPath;
      continue;
    }

    groups.set(key, {
      key,
      label,
      path: groupPath,
      worktrees: [worktree],
      totalSizeBytes: worktree.sizeBytes,
    });
  }

  return Array.from(groups.values());
}

function WorktreeListLoading() {
  return (
    <div
      className="bg-muted/10 flex min-h-48 flex-col gap-0 overflow-hidden rounded-lg border border-border"
      aria-label="Loading managed worktrees"
    >
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 px-4 py-4 last:border-b-0"
        >
          <div className="min-w-0 space-y-2">
            <div className="worktree-loading-shimmer h-4 w-40 rounded" />
            <div className="worktree-loading-shimmer h-3 w-full max-w-lg rounded" />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="worktree-loading-shimmer h-5 w-16 rounded-full" />
            <div className="worktree-loading-shimmer h-3 w-12 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function WorktreeCleanupSettingsCard() {
  const queryClient = useQueryClient();
  const showConfirm = useShowModal('confirmActionModal');
  const { value, defaults, update, isLoading, isSaving, isFieldOverridden, resetField } =
    useAppSettingsKey('worktreeCleanup');

  const worktreesQuery = useQuery<ManagedWorktreesSummary>({
    queryKey: managedWorktreesQueryKey,
    queryFn: () => rpc.worktreeCleanup.listManagedWorktrees(),
    refetchInterval: (query) => (query.state.data?.isRefreshing ? 500 : false),
    staleTime: 30_000,
  });

  React.useEffect(() => {
    const offSize = events.on(managedWorktreeSizeUpdatedChannel, ({ workspaceId, sizeBytes }) => {
      queryClient.setQueryData<ManagedWorktreesSummary>(managedWorktreesQueryKey, (prev) => {
        if (!prev) return prev;
        const worktrees = prev.worktrees.map((worktree) =>
          worktree.workspaceId === workspaceId ? { ...worktree, sizeBytes } : worktree
        );
        return {
          ...prev,
          worktrees,
          totalSizeBytes: worktrees.reduce((sum, worktree) => sum + worktree.sizeBytes, 0),
        };
      });
    });
    const offDone = events.on(managedWorktreeRefreshCompleteChannel, ({ totalSizeBytes }) => {
      queryClient.setQueryData<ManagedWorktreesSummary>(managedWorktreesQueryKey, (prev) =>
        prev ? { ...prev, totalSizeBytes, isRefreshing: false } : prev
      );
      void queryClient.invalidateQueries({ queryKey: managedWorktreesQueryKey });
    });
    return () => {
      offSize();
      offDone();
    };
  }, [queryClient]);

  const refreshMutation = useMutation({
    mutationFn: () => rpc.worktreeCleanup.listManagedWorktrees({ forceRefresh: true }),
    onSuccess: (summary) => {
      queryClient.setQueryData(managedWorktreesQueryKey, summary);
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: () => rpc.worktreeCleanup.cleanupNow(),
    onSuccess: (summary) => {
      queryClient.setQueryData(managedWorktreesQueryKey, summary);
    },
  });

  const removeWorktreeMutation = useMutation({
    mutationFn: (workspaceId: string) => rpc.worktreeCleanup.removeWorktree(workspaceId),
    onSuccess: (summary) => {
      queryClient.setQueryData(managedWorktreesQueryKey, summary);
    },
  });

  const busy = isLoading || isSaving;
  const summary = worktreesQuery.data;
  const isLoadingWorktrees = (!summary && worktreesQuery.isFetching) || summary?.isRefreshing;
  const worktreeGroups = React.useMemo(
    () => groupWorktreesByProject(summary?.worktrees ?? []),
    [summary?.worktrees]
  );

  if (!defaults) return null;
  const settings = value ?? defaults;
  const autoCleanupEnabled = settings.autoCleanupEnabled;
  const cleanupInterval = formatCleanupInterval(WORKTREE_CLEANUP_INTERVAL_MS);

  const requestCleanup = () => {
    showConfirm({
      title: 'Cleanup worktrees',
      description:
        'This will delete eligible archived, orphaned, or missing managed worktrees until the configured limits are met.',
      confirmLabel: 'Delete',
      variant: 'destructive',
      onSuccess: () => {
        cleanupMutation.mutate();
      },
    });
  };

  const requestRemoveWorktree = (worktree: ManagedWorktree) => {
    const activeWarning =
      worktree.status === 'active'
        ? ' The linked task will be archived and its running session terminated.'
        : '';
    showConfirm({
      title: 'Delete worktree',
      description: `This will permanently delete the worktree below.${activeWarning} Uncommitted changes will be lost.`,
      detail: worktree.path,
      confirmLabel: 'Delete',
      variant: 'destructive',
      onSuccess: () => {
        removeWorktreeMutation.mutate(worktree.workspaceId);
      },
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <SettingRow
          title="Automatic cleanup"
          description={`Every ${cleanupInterval}, remove eligible managed worktrees that exceed the limits below. When off, cleanup only runs when you trigger it manually.`}
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('autoCleanupEnabled')}
                defaultLabel={defaults.autoCleanupEnabled ? 'On' : 'Off'}
                onReset={() => resetField('autoCleanupEnabled')}
                disabled={busy}
              />
              <Switch
                checked={autoCleanupEnabled}
                disabled={busy}
                onCheckedChange={(next) => {
                  if (next) {
                    showConfirm({
                      title: 'Enable automatic cleanup?',
                      description: `Emdash will check every ${cleanupInterval} and delete eligible archived, orphaned, or missing managed worktrees in the background once the limits below are exceeded. Active tasks are never touched.`,
                      confirmLabel: 'Enable',
                      variant: 'destructive',
                      onSuccess: () => update({ autoCleanupEnabled: true }),
                    });
                    return;
                  }
                  update({ autoCleanupEnabled: false });
                }}
              />
            </>
          }
        />
        <AnimatedHeight>
          {autoCleanupEnabled && (
            <div className="flex flex-col gap-4 pt-4">
              <SettingRow
                title="Max worktrees"
                description="Maximum number of Emdash-managed worktrees to retain across all local workspaces. Older eligible worktrees are removed first."
                control={
                  <>
                    <ResetToDefaultButton
                      visible={isFieldOverridden('maxWorktrees')}
                      defaultLabel={String(defaults.maxWorktrees)}
                      onReset={() => resetField('maxWorktrees')}
                      disabled={busy}
                    />
                    <SettingsNumberStepper
                      value={settings.maxWorktrees}
                      min={1}
                      max={500}
                      step={1}
                      disabled={busy}
                      label="Maximum worktrees"
                      onChange={(maxWorktrees) => update({ maxWorktrees })}
                    />
                  </>
                }
              />
              <SettingRow
                title="Max total size"
                description="Maximum total size, in GB, across all Emdash-managed local worktrees. Set to 0 to disable the size limit."
                control={
                  <>
                    <ResetToDefaultButton
                      visible={isFieldOverridden('maxTotalSizeGb')}
                      defaultLabel={String(defaults.maxTotalSizeGb)}
                      onReset={() => resetField('maxTotalSizeGb')}
                      disabled={busy}
                    />
                    <SettingsNumberStepper
                      value={settings.maxTotalSizeGb}
                      min={0}
                      max={10_000}
                      step={5}
                      disabled={busy}
                      label="Maximum total size in GB"
                      unit="GB"
                      onChange={(maxTotalSizeGb) => update({ maxTotalSizeGb })}
                    />
                  </>
                }
              />
            </div>
          )}
        </AnimatedHeight>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="text-sm font-normal text-foreground">Managed worktrees</h3>
            <p className="text-xs text-foreground-passive">
              {summary?.isRefreshing
                ? summary.worktrees.length > 0
                  ? `${summary.worktrees.length} ${summary.worktrees.length === 1 ? 'worktree' : 'worktrees'} · loading sizes...`
                  : 'Loading managed worktrees...'
                : summary
                  ? `${summary.worktrees.length} ${summary.worktrees.length === 1 ? 'worktree' : 'worktrees'} · ${formatBytes(summary.totalSizeBytes)}`
                  : 'Worktrees Emdash created on this machine.'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Refresh managed worktrees"
                  disabled={worktreesQuery.isFetching || refreshMutation.isPending}
                  onClick={() => refreshMutation.mutate()}
                >
                  <RefreshCw
                    className={cn(
                      'size-4',
                      (worktreesQuery.isFetching || refreshMutation.isPending) && 'animate-spin'
                    )}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
            <Button
              type="button"
              variant="ghost"
              className="hover:text-foreground-destructive"
              disabled={cleanupMutation.isPending}
              onClick={requestCleanup}
            >
              <Trash2 className="size-4" />
              Cleanup now
            </Button>
          </div>
        </div>

        {isLoadingWorktrees && (!summary || summary.worktrees.length === 0) ? (
          <WorktreeListLoading />
        ) : !summary || summary.worktrees.length === 0 ? (
          <div className="bg-muted/10 flex min-h-48 flex-col items-center justify-center rounded-lg border border-border p-8 text-center">
            <FolderIcon className="mb-3 size-8 text-foreground-passive" />
            <div className="text-sm text-foreground">No managed worktrees</div>
            <p className="mt-1 max-w-sm text-xs text-foreground-passive">
              Worktrees Emdash creates for tasks will appear here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {worktreeGroups.map((group) => (
              <div
                key={group.key}
                className="bg-muted/10 overflow-hidden rounded-lg border border-border"
              >
                <div className="bg-muted/20 flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-foreground">{group.label}</div>
                    {group.path ? (
                      <div className="mt-0.5 truncate text-xs text-foreground-passive">
                        {group.path}
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right text-xs text-foreground-passive tabular-nums">
                    {group.worktrees.length}{' '}
                    {group.worktrees.length === 1 ? 'worktree' : 'worktrees'} ·{' '}
                    {formatBytes(group.totalSizeBytes)}
                  </div>
                </div>
                <div className="divide-y divide-border/60">
                  {group.worktrees.map((worktree) => {
                    const isDeleting =
                      removeWorktreeMutation.isPending &&
                      removeWorktreeMutation.variables === worktree.workspaceId;
                    return (
                      <div
                        key={worktree.workspaceId}
                        className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-3 pr-4 pl-8"
                      >
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm text-foreground">
                              {worktree.taskName ?? worktree.branch ?? worktree.workspaceId}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-xs text-foreground-passive">
                            {worktree.path}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-foreground-passive tabular-nums">
                          {formatBytes(worktree.sizeBytes)}
                        </div>
                        <Tooltip>
                          <TooltipTrigger>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Delete ${worktree.taskName ?? worktree.path}`}
                              className="hover:text-foreground-destructive"
                              disabled={isDeleting}
                              onClick={() => requestRemoveWorktree(worktree)}
                            >
                              <Trash2 className={cn('size-4', isDeleting && 'animate-pulse')} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="left">Delete this worktree</TooltipContent>
                        </Tooltip>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
