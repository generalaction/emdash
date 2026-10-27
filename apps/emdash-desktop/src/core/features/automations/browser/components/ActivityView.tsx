import { AgentStatus as AgentStatusUi, EmptyState } from '@emdash/ui/react/components';
import { CollectionToolbar } from '@emdash/ui/react/patterns';
import { AbsoluteTime, Button, toast, Tooltip } from '@emdash/ui/react/primitives';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Folder,
  Loader2,
  MinusCircle,
  XCircle,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { isAutomationRunAdoptable } from '@core/features/automations/api/automation-run';
import { getAutomationRunStore } from '@core/features/automations/browser/automation-run-store';
import { useAutomationRunActions } from '@core/features/automations/browser/use-automation-run-actions';
import { taskAgentStatus } from '@core/features/conversations/api/browser/conversation-selectors';
import {
  getProjectStore,
  projectDisplayName,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { TaskGitDiffStats } from '@core/features/tasks/contributions/browser/task-git-diff-stats';
import {
  getRegisteredTaskData,
  getTaskIdForAutomationRun,
  getTaskStore,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import type { AgentStatus } from '@core/primitives/agents/api';
import type { Automation, AutomationRun, AutomationRunStatus } from '@core/primitives/automations/api';
import { useSearchFocusHotkeys } from '@core/primitives/keybindings/browser';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';
import {
  formatAutomationError,
  formatRunError,
  formatRunTriggerKindLabel,
} from '../automation-run-format';

export type ActivityFilter = 'all' | 'active' | 'completed' | 'failed';

export type ActivityStatus =
  | 'working'
  | 'awaiting-input'
  | 'queued'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export interface ActivityItem {
  run: AutomationRun;
  automation: Automation;
  projectId: string;
}

export function getActivityStatus(
  runStatus: AutomationRunStatus,
  agentStatus: AgentStatus | null
): ActivityStatus {
  if (runStatus === 'failed' || agentStatus === 'error') return 'failed';
  if (agentStatus === 'awaiting-input') return 'awaiting-input';
  if (
    agentStatus === 'working' ||
    runStatus === 'provisioning_workspace' ||
    runStatus === 'starting_session'
  ) {
    return 'working';
  }
  if (runStatus === 'queued') return 'queued';
  if (runStatus === 'cancelled') return 'cancelled';
  if (runStatus === 'skipped') return 'skipped';
  return 'done';
}

export function useCrossProjectActivity(automations: Automation[]): ActivityItem[] {
  const [, setVersion] = useState(0);

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    for (const auto of automations) {
      if (!auto.projectId) continue;
      const store = getAutomationRunStore(auto.projectId, auto.id);
      const release = store.acquire();
      const unsub = store.subscribe(() => {
        setVersion((v) => v + 1);
      });
      void store.loadInitialHistory('all', 10);
      cleanups.push(release, unsub);
    }
    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [automations]);

  return useMemo(() => {
    const items: ActivityItem[] = [];
    for (const auto of automations) {
      if (!auto.projectId) continue;
      const store = getAutomationRunStore(auto.projectId, auto.id);
      const history = store.history('all');
      const seen = new Set<string>();
      for (const run of history) {
        seen.add(run.id);
        items.push({ run, automation: auto, projectId: auto.projectId });
      }
      if (store.latestRun && !seen.has(store.latestRun.id)) {
        items.push({ run: store.latestRun, automation: auto, projectId: auto.projectId });
      }
    }

    items.sort((a, b) => {
      const timeA = a.run.startedAt ?? a.run.finishedAt ?? a.run.scheduledAt ?? 0;
      const timeB = b.run.startedAt ?? b.run.finishedAt ?? b.run.scheduledAt ?? 0;
      return timeB - timeA;
    });

    return items;
  }, [automations]);
}

interface ActivityViewProps {
  automations: Automation[];
  onOpenAutomation: (automation: Automation) => void;
}

export const ActivityView = observer(function ActivityView({
  automations,
  onOpenAutomation,
}: ActivityViewProps) {
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useSearchFocusHotkeys();

  const allItems = useCrossProjectActivity(automations);

  const counts = useMemo(() => {
    let active = 0;
    let completed = 0;
    let failed = 0;

    for (const item of allItems) {
      const taskId = getTaskIdForAutomationRun(item.projectId, item.run.id);
      const taskStore = taskId ? getTaskStore(item.projectId, taskId) : undefined;
      const agentStatus = taskStore ? taskAgentStatus(taskStore) : null;
      const status = getActivityStatus(item.run.status, agentStatus);

      if (status === 'working' || status === 'queued' || status === 'awaiting-input') {
        active++;
      } else if (status === 'failed') {
        failed++;
      } else if (status === 'done') {
        completed++;
      }
    }

    return { all: allItems.length, active, completed, failed };
  }, [allItems]);

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return allItems.filter((item) => {
      const taskId = getTaskIdForAutomationRun(item.projectId, item.run.id);
      const taskStore = taskId ? getTaskStore(item.projectId, taskId) : undefined;
      const agentStatus = taskStore ? taskAgentStatus(taskStore) : null;
      const status = getActivityStatus(item.run.status, agentStatus);

      if (filter === 'active') {
        if (status !== 'working' && status !== 'queued' && status !== 'awaiting-input') return false;
      } else if (filter === 'completed') {
        if (status !== 'done') return false;
      } else if (filter === 'failed') {
        if (status !== 'failed') return false;
      }

      if (!query) return true;

      const projectStore = getProjectStore(item.projectId);
      const projectName = projectStore ? projectDisplayName(projectStore) : item.projectId;
      const taskName = taskStore?.displayName ?? item.run.generatedName ?? '';

      return (
        item.automation.name.toLowerCase().includes(query) ||
        projectName.toLowerCase().includes(query) ||
        taskName.toLowerCase().includes(query)
      );
    });
  }, [allItems, filter, searchQuery]);

  return (
    <div className="flex w-full flex-col gap-4">
      <CollectionToolbar.Root>
        <CollectionToolbar.Search
          ref={searchRef}
          value={searchQuery}
          onValueChange={setSearchQuery}
          placeholder="Filter activity by automation, project, or task…"
        />
        <CollectionToolbar.Spacer />
        <CollectionToolbar.Group>
          <div className="flex items-center gap-1">
            {(
              [
                { value: 'all', label: 'All', count: counts.all },
                { value: 'active', label: 'Active', count: counts.active },
                { value: 'completed', label: 'Completed', count: counts.completed },
                { value: 'failed', label: 'Failed', count: counts.failed },
              ] as const
            ).map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setFilter(tab.value)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  filter === tab.value
                    ? 'bg-background-2 text-foreground'
                    : 'text-foreground-muted hover:bg-background-1 hover:text-foreground'
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    'tabular-nums text-tiny',
                    filter === tab.value ? 'text-foreground-muted' : 'text-foreground-passive'
                  )}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </CollectionToolbar.Group>
      </CollectionToolbar.Root>

      {filteredItems.length === 0 ? (
        <EmptyState
          bare
          label={
            searchQuery
              ? 'No activity matches your search.'
              : filter !== 'all'
                ? `No ${filter} automation activity.`
                : 'No recent automation activity.'
          }
          description={
            !searchQuery && filter === 'all'
              ? 'When automations trigger across your projects, their runs and active tasks will appear here.'
              : undefined
          }
        />
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background-1/40">
          {filteredItems.map((item) => (
            <ActivityRow
              key={item.run.id}
              item={item}
              onOpenAutomation={onOpenAutomation}
            />
          ))}
        </div>
      )}
    </div>
  );
});

interface ActivityRowProps {
  item: ActivityItem;
  onOpenAutomation: (automation: Automation) => void;
}

export const ActivityRow = observer(function ActivityRow({
  item,
  onOpenAutomation,
}: ActivityRowProps) {
  const { navigate } = useNavigate();
  const { run, automation, projectId } = item;
  const { adoptRun, isAdopting, runtimeAvailable } = useAutomationRunActions(
    automation.id,
    projectId
  );

  const taskId = getTaskIdForAutomationRun(projectId, run.id);
  const taskStore = taskId ? getTaskStore(projectId, taskId) : undefined;
  const task = taskId ? getRegisteredTaskData(projectId, taskId) : undefined;
  const agentStatus = taskStore ? taskAgentStatus(taskStore) : null;
  const status = getActivityStatus(run.status, agentStatus);

  const interactive = Boolean(
    (taskId && !task?.archivedAt) ||
      (!taskId && runtimeAvailable && isAutomationRunAdoptable(run) && !isAdopting)
  );

  const projectStore = getProjectStore(projectId);
  const projectName = projectStore ? projectDisplayName(projectStore) : projectId;
  const taskName = taskStore?.displayName ?? run.generatedName ?? 'Automation Run';
  const displayTime = run.startedAt ?? run.finishedAt;
  const missedDeadline = run.error?.code === 'deadline_exceeded';

  async function handleOpenTask() {
    if (!interactive) return;
    try {
      const adopted = taskId ? { taskId, projectId } : await adoptRun(run.id);
      navigate(taskViewDef(adopted));
    } catch (error) {
      toast.error('Could not open task', {
        description: formatAutomationError(error),
      });
    }
  }

  return (
    <div
      className={cn(
        'group flex flex-col gap-2 p-3 transition-colors',
        interactive && 'hover:bg-background-2/60 cursor-pointer'
      )}
      onClick={interactive ? () => void handleOpenTask() : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void handleOpenTask();
              }
            }
          : undefined
      }
    >
      {/* Top line: Status, Automation, Project, Time, Trigger */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ActivityStatusBadge status={status} error={run.error} />

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenAutomation(automation);
            }}
            className="truncate text-xs font-semibold text-foreground hover:underline"
            title={`View ${automation.name} details`}
          >
            {automation.name}
          </button>

          <span className="text-foreground-passive">•</span>

          <div className="flex items-center gap-1 text-xs text-foreground-muted">
            <Folder className="size-3 shrink-0" />
            <span className="truncate max-w-40">{projectName}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 text-tiny text-foreground-muted">
          <span className="rounded bg-background-2 px-1.5 py-0.5 text-foreground-passive">
            {formatRunTriggerKindLabel(run.triggerKind)}
          </span>
          {displayTime && <AbsoluteTime value={displayTime} className="text-foreground-muted" />}
        </div>
      </div>

      {/* Middle line: Task Title, Agent status icon, Git diff stats */}
      <div className="flex min-w-0 items-center justify-between gap-2 pl-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'min-w-0 truncate text-sm font-medium',
              missedDeadline ? 'text-destructive' : 'text-foreground'
            )}
          >
            {taskName}
          </span>
          <AgentStatusUi status={agentStatus} tooltip />
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {taskStore && <TaskGitDiffStats task={taskStore} />}
          {interactive && (
            <Button
              variant="ghost"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                void handleOpenTask();
              }}
              className="text-xs text-foreground-muted group-hover:text-foreground"
            >
              Open task
              <ArrowRight className="ml-1 size-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Error message if failed */}
      {run.error && (
        <div className="rounded bg-destructive/10 px-2.5 py-1 text-xs text-destructive">
          {formatRunError(run.error)}
        </div>
      )}
    </div>
  );
});

function ActivityStatusBadge({
  status,
  error,
}: {
  status: ActivityStatus;
  error: AutomationRun['error'];
}) {
  const base = 'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-tiny font-medium';

  switch (status) {
    case 'working':
      return (
        <span className={cn(base, 'bg-background-info text-foreground-info')}>
          <Loader2 className="size-3 animate-spin" />
          Working
        </span>
      );
    case 'awaiting-input':
      return (
        <span className={cn(base, 'bg-background-warning text-foreground-warning')}>
          <AlertCircle className="size-3" />
          Awaiting input
        </span>
      );
    case 'queued':
      return (
        <span className={cn(base, 'bg-background-3 text-foreground-muted')}>
          <Clock className="size-3" />
          Queued
        </span>
      );
    case 'done':
      return (
        <span className={cn(base, 'bg-background-success text-foreground-success')}>
          <CheckCircle2 className="size-3" />
          Completed
        </span>
      );
    case 'failed':
      return error ? (
        <Tooltip.Root>
          <Tooltip.Trigger
            render={
              <span className={cn(base, 'bg-destructive/10 text-destructive cursor-default')}>
                <XCircle className="size-3" />
                Failed
              </span>
            }
          />
          <Tooltip.Content>{formatRunError(error)}</Tooltip.Content>
        </Tooltip.Root>
      ) : (
        <span className={cn(base, 'bg-destructive/10 text-destructive')}>
          <XCircle className="size-3" />
          Failed
        </span>
      );
    case 'cancelled':
    case 'skipped':
      return (
        <span className={cn(base, 'bg-background-3 text-muted-foreground')}>
          <MinusCircle className="size-3" />
          {status === 'cancelled' ? 'Cancelled' : 'Skipped'}
        </span>
      );
  }
}
