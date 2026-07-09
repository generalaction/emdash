import { useMutation, useQuery } from '@tanstack/react-query';
import { Archive, HardDrive, Info, RefreshCw, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import type { StoragePathState, TaskStorageUsage } from '@shared/core/storage/storage';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unitIndex]}`;
}

function formatActivityDate(value?: string): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const now = new Date();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

function formatTaskCount(count: number): string {
  return `${count} ${count === 1 ? 'task' : 'tasks'}`;
}

function pathStateLabel(state: StoragePathState): string {
  switch (state) {
    case 'measured':
      return 'Ready';
    case 'missing':
      return 'Missing';
    case 'not-worktree':
      return 'No worktree';
    case 'remote':
      return 'Remote';
    case 'no-path':
      return 'No worktree path';
    case 'error':
      return 'Scan error';
  }
}

function InfoTooltip({ label, content }: { label: string; content: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger>
        <button
          type="button"
          className="inline-flex size-4 items-center justify-center text-foreground-muted hover:text-foreground"
          aria-label={label}
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-xs">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

function LabelWithInfo({
  label,
  tooltipLabel,
  tooltip,
}: {
  label: string;
  tooltipLabel: string;
  tooltip: ReactNode;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="truncate">{label}</span>
      <InfoTooltip label={tooltipLabel} content={tooltip} />
    </span>
  );
}

function StorageStat({ label, value, icon }: { label: ReactNode; value: string; icon: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-background-secondary-1 px-3 py-2">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background-2 text-foreground-muted">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs text-foreground-muted">{label}</div>
        <div className="truncate text-sm text-foreground">{value}</div>
      </div>
    </div>
  );
}

type ActionStatus = {
  kind: 'info' | 'success' | 'error';
  message: string;
};

function TaskRow({
  task,
  selected,
  onSelectedChange,
}: {
  task: TaskStorageUsage;
  selected: boolean;
  onSelectedChange: (taskId: string, selected: boolean) => void;
}) {
  const lastActivity = task.lastInteractedAt ?? task.updatedAt ?? task.createdAt;
  const pathStatus = task.pathState === 'measured' ? null : pathStateLabel(task.pathState);
  const details = [task.isActive ? 'Active task' : null, pathStatus].filter(Boolean).join(' · ');
  return (
    <div className="grid min-h-12 grid-cols-[28px_minmax(0,1fr)_104px_88px] items-center gap-3 px-3 py-2 text-sm">
      <Checkbox
        checked={selected}
        disabled={!task.canDelete}
        aria-label={`Select ${task.taskName}`}
        onCheckedChange={(checked) => onSelectedChange(task.taskId, Boolean(checked))}
      />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-foreground">{task.taskName}</span>
          {task.archivedAt && <Archive className="size-3.5 shrink-0 text-foreground-muted" />}
        </div>
        {details && <div className="truncate text-xs text-foreground-muted">{details}</div>}
      </div>
      <div className="text-right text-foreground tabular-nums">
        {formatBytes(task.reclaimableBytes)}
      </div>
      <div className="text-right text-foreground-muted tabular-nums">
        {formatActivityDate(lastActivity)}
      </div>
    </div>
  );
}

export function StorageSettingsPage() {
  const showConfirm = useShowModal('confirmActionModal');
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());

  const {
    data: usage = null,
    error: usageError,
    isFetching: isLoading,
    isLoading: isInitialQueryLoading,
    refetch: refetchUsage,
  } = useQuery({
    queryKey: ['storage', 'taskUsage'],
    queryFn: () => rpc.storage.listTaskStorageUsage(),
    refetchOnWindowFocus: false,
  });
  const { isPending: isDeleting, mutateAsync: deleteStorageTasks } = useMutation({
    mutationFn: (taskIds: string[]) => rpc.storage.deleteTasks(taskIds),
  });

  const allTasks = useMemo(
    () => usage?.projects.flatMap((project) => project.tasks) ?? [],
    [usage]
  );
  const tasksById = useMemo(() => new Map(allTasks.map((task) => [task.taskId, task])), [allTasks]);
  const selectedTasks = useMemo(
    () =>
      Array.from(selectedTaskIds)
        .map((taskId) => tasksById.get(taskId))
        .filter((task): task is TaskStorageUsage => !!task?.canDelete),
    [selectedTaskIds, tasksById]
  );

  const selectedReclaimableBytes = selectedTasks.reduce(
    (sum, task) => sum + task.reclaimableBytes,
    0
  );
  const isInitialLoading = isInitialQueryLoading && !usage;
  const deleteButtonLabel = selectedTasks.length === 1 ? 'Delete Task' : 'Delete Tasks';
  const loadErrorMessage = usageError
    ? `Could not load storage usage: ${
        usageError instanceof Error ? usageError.message : String(usageError)
      }`
    : null;

  const setTaskSelected = useCallback((taskId: string, selected: boolean) => {
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  }, []);

  const runDelete = useCallback(async () => {
    const taskIds = selectedTasks.map((task) => task.taskId);
    if (taskIds.length === 0) return;
    const taskCount = formatTaskCount(taskIds.length);
    setActionStatus({ kind: 'info', message: `Deleting ${taskCount}...` });
    try {
      const result = await deleteStorageTasks(taskIds);
      if (result.failedCount > 0) {
        const firstFailure = result.results.find((item) => !item.success);
        setActionStatus({
          kind: 'error',
          message: `${result.deletedCount} deleted, ${result.failedCount} failed${
            firstFailure && !firstFailure.success ? `: ${firstFailure.message}` : ''
          }`,
        });
        toast({
          title: `${result.deletedCount} deleted, ${result.failedCount} failed`,
          description: firstFailure && !firstFailure.success ? firstFailure.message : undefined,
          variant: 'destructive',
        });
        setSelectedTaskIds(
          new Set(result.results.filter((item) => !item.success).map((item) => item.taskId))
        );
      } else {
        const deletedText = `${formatTaskCount(result.deletedCount)} deleted`;
        setActionStatus({ kind: 'success', message: deletedText });
        toast({ title: deletedText });
        setSelectedTaskIds(new Set());
      }
      await refetchUsage();
    } catch (error) {
      setActionStatus({
        kind: 'error',
        message: `Could not delete selected tasks: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      toast({
        title: 'Could not delete selected tasks',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }, [deleteStorageTasks, refetchUsage, selectedTasks]);

  const confirmDelete = useCallback(() => {
    if (selectedTasks.length === 0) return;
    const count = selectedTasks.length;
    showConfirm({
      title: `Delete ${count} selected ${count === 1 ? 'task' : 'tasks'}?`,
      description: 'This removes the selected task rows and their owned worktrees.',
      confirmLabel: count === 1 ? 'Delete Task' : 'Delete Tasks',
      variant: 'destructive',
      onSuccess: () => {
        void runDelete();
      },
    });
  }, [runDelete, selectedTasks.length, showConfirm]);

  const toggleProject = useCallback((tasks: TaskStorageUsage[], selected: boolean) => {
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      for (const task of tasks) {
        if (!task.canDelete) continue;
        if (selected) {
          next.add(task.taskId);
        } else {
          next.delete(task.taskId);
        }
      }
      return next;
    });
  }, []);

  return (
    <TooltipProvider delay={150}>
      <div className="flex flex-col gap-4 pb-10">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
          <StorageStat
            label={
              <LabelWithInfo
                label="Total"
                tooltipLabel="About total size"
                tooltip="Estimated disk space used by measured task worktrees. This is the amount Emdash expects to free when those tasks and their owned worktrees are deleted."
              />
            }
            value={formatBytes(usage?.reclaimableBytes ?? 0)}
            icon={<HardDrive className="size-4" />}
          />
          <StorageStat
            label="Selected"
            value={formatBytes(selectedReclaimableBytes)}
            icon={<Trash2 className="size-4" />}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-h-5 min-w-0 items-center gap-3 text-xs text-foreground-muted">
            <span className="shrink-0">
              {usage ? `${formatTaskCount(usage.taskCount)} scanned` : 'Scanning tasks'}
            </span>
            {actionStatus && (
              <span
                title={actionStatus.message}
                className={cn(
                  'inline-flex min-w-0 items-center gap-1.5 truncate',
                  actionStatus.kind === 'error'
                    ? 'text-foreground-destructive'
                    : actionStatus.kind === 'success'
                      ? 'text-foreground-success'
                      : 'text-foreground-muted'
                )}
              >
                {actionStatus.kind === 'info' && <Spinner className="size-3 shrink-0" />}
                <span className="truncate">{actionStatus.message}</span>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isLoading}
              onClick={() => void refetchUsage()}
            >
              <RefreshCw className={cn('size-4', isLoading && usage && 'animate-spin')} />
              Refresh
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={selectedTasks.length === 0 || isDeleting}
              onClick={confirmDelete}
            >
              <Trash2 className="size-4" />
              {deleteButtonLabel}
            </Button>
          </div>
        </div>

        {isInitialLoading ? (
          <div className="flex h-40 items-center justify-center gap-2 text-sm text-foreground-muted">
            <Spinner className="size-4" />
            Scanning storage
          </div>
        ) : !usage ? (
          <div className="flex h-40 items-center justify-center text-sm text-foreground-muted">
            {loadErrorMessage ?? 'Storage usage is unavailable.'}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {usage?.projects.map((project) => {
              const selectableTasks = project.tasks.filter((task) => task.canDelete);
              const selectedCount = selectableTasks.filter((task) =>
                selectedTaskIds.has(task.taskId)
              ).length;
              const allSelected =
                selectableTasks.length > 0 && selectedCount === selectableTasks.length;
              return (
                <section
                  key={project.projectId}
                  className="overflow-hidden rounded-lg border border-border/70 bg-background-secondary-1"
                >
                  <div className="grid grid-cols-[28px_minmax(0,1fr)_104px_88px] items-center gap-3 border-b border-border/60 px-3 py-2 text-xs text-foreground-muted">
                    <Checkbox
                      checked={allSelected}
                      disabled={selectableTasks.length === 0}
                      aria-label={`Select ${project.projectName}`}
                      onCheckedChange={(checked) => toggleProject(project.tasks, Boolean(checked))}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm text-foreground">{project.projectName}</div>
                      <div className="truncate">{project.projectPath}</div>
                    </div>
                    <div className="text-right">Total</div>
                    <div className="text-right">Last active</div>
                  </div>
                  <div className="divide-y divide-border/50">
                    {project.tasks.map((task) => (
                      <TaskRow
                        key={task.taskId}
                        task={task}
                        selected={task.canDelete && selectedTaskIds.has(task.taskId)}
                        onSelectedChange={setTaskSelected}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
