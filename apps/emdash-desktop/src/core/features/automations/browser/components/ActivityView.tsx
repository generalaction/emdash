import { formatHostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { createScope } from '@emdash/shared/concurrency';
import { AgentStatus as AgentStatusUi, EmptyState } from '@emdash/ui/react/components';
import { CollectionToolbar } from '@emdash/ui/react/patterns';
import { AbsoluteTime, Button, Spinner, toast, Tooltip } from '@emdash/ui/react/primitives';
import { observe, remote } from '@emdash/wire/state';
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
import { useEffect, useState } from 'react';
import {
  isAutomationRunAdoptable,
  type AutomationRun,
  type AutomationRunStatus,
} from '@core/features/automations/api/automation-run';
import { getAutomationRunStore } from '@core/features/automations/browser/automation-run-store';
import { useAutomationRunActions } from '@core/features/automations/browser/use-automation-run-actions';
import { conversationsContract } from '@core/features/conversations/api';
import { getConversationsClient } from '@core/features/conversations/api/browser/client';
import { taskAgentStatus } from '@core/features/conversations/api/browser/conversation-selectors';
import {
  getProjectStore,
  projectData,
  projectDisplayName,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { TaskGitDiffStats } from '@core/features/tasks/contributions/browser/task-git-diff-stats';
import type { TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import {
  getRegisteredTaskData,
  getTaskIdForAutomationRun,
  getTaskStore,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import type { AgentStatus } from '@core/primitives/agents/api';
import type { Automation } from '@core/primitives/automations/api';
import { useSearchFocusHotkeys } from '@core/primitives/keybindings/browser';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { projectHostRef } from '@core/primitives/projects/api';
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
  agentStatus: AgentStatus | null,
  options?: {
    hasTask?: boolean;
    isSessionActive?: boolean;
  }
): ActivityStatus {
  if (runStatus === 'failed' || agentStatus === 'error') return 'failed';
  if (agentStatus === 'awaiting-input') return 'awaiting-input';
  if (
    agentStatus === 'working' ||
    runStatus === 'provisioning_workspace' ||
    runStatus === 'starting_session' ||
    options?.isSessionActive === true
  ) {
    return 'working';
  }
  if (runStatus === 'queued') return 'queued';
  if (runStatus === 'cancelled') return 'cancelled';
  if (runStatus === 'skipped') return 'skipped';

  if (runStatus === 'done') {
    if (agentStatus === 'completed' || agentStatus === 'idle') {
      return 'done';
    }
    if (options?.hasTask) {
      return 'done';
    }
    if (options?.isSessionActive === undefined && agentStatus === null) {
      return 'working';
    }
    return 'done';
  }

  return 'done';
}

export interface CrossProjectActivityResult {
  items: ActivityItem[];
  isLoading: boolean;
  errors: { automation: Automation; error: Error }[];
  activeSessions: Set<string>;
  hasLoadedSessions: boolean;
  conversationStatuses: Map<string, AgentStatus>;
}

export function useCrossProjectActivity(automations: Automation[]): CrossProjectActivityResult {
  const [version, setVersion] = useState(0);
  const [conversationStatuses, setConversationStatuses] = useState<Map<string, AgentStatus>>(
    () => new Map()
  );
  const [activeSessions, setActiveSessions] = useState<Set<string>>(() => new Set());
  const [hasLoadedSessions, setHasLoadedSessions] = useState(false);

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

  useEffect(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];

    void getConversationsClient().then((client) => {
      if (disposed) return;

      void client.events
        .subscribe(undefined, {
          onEvent: (event) => {
            if (disposed) return;
            if (event.type === 'agent-status-changed') {
              setConversationStatuses((prev) => {
                const next = new Map(prev);
                next.set(event.conversationId, event.status);
                return next;
              });
            }
          },
        })
        .then((unsub) => {
          if (disposed) unsub();
          else cleanups.push(unsub);
        });

      const projectIds = [
        ...new Set(automations.map((a) => a.projectId).filter(Boolean)),
      ] as string[];
      const activeAcpByProject = new Map<string, Set<string>>();
      const activeTuiByProject = new Map<string, Set<string>>();

      const updateAllActive = () => {
        if (disposed) return;
        const combined = new Set<string>();
        for (const set of activeAcpByProject.values()) {
          for (const id of set) combined.add(id);
        }
        for (const set of activeTuiByProject.values()) {
          for (const id of set) combined.add(id);
        }
        setActiveSessions(combined);
        setHasLoadedSessions(true);
      };

      for (const projectId of projectIds) {
        const pData = projectData(getProjectStore(projectId));
        const host = formatHostRef(pData ? projectHostRef(pData) : LOCAL_HOST_REF);

        const scope = createScope({ label: `cross-project-activity:${projectId}` });
        cleanups.push(() => void scope.dispose());

        const acpSessions = remote(conversationsContract.acp.sessions, client.acp.sessions, {
          scope,
          lingerMs: 15_000,
        });
        const acpMember = acpSessions({ host, projectId });
        observe(
          acpMember.states.list,
          (snapshot) => {
            const set = new Set<string>();
            for (const [convId, sess] of Object.entries(snapshot.value ?? {})) {
              if (sess.lifecycle !== 'closed') {
                set.add(convId);
              }
            }
            activeAcpByProject.set(projectId, set);
            updateAllActive();
          },
          { scope }
        );

        const tuiSessions = remote(conversationsContract.tui.sessions, client.tui.sessions, {
          scope,
          lingerMs: 15_000,
        });
        const tuiMember = tuiSessions({ host, projectId });
        observe(
          tuiMember.states.list,
          (snapshot) => {
            const set = new Set<string>();
            for (const [convId, sess] of Object.entries(snapshot.value ?? {})) {
              if (sess.status === 'starting' || sess.status === 'running') {
                set.add(convId);
              }
            }
            activeTuiByProject.set(projectId, set);
            updateAllActive();
          },
          { scope }
        );
      }
    });

    return () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
    };
  }, [automations]);

  void version;

  const items: ActivityItem[] = [];
  const errors: { automation: Automation; error: Error }[] = [];
  let isAnyStoreLoading = false;

  for (const auto of automations) {
    if (!auto.projectId) continue;
    const store = getAutomationRunStore(auto.projectId, auto.id);
    const histState = store.historyState('all');
    if (histState.loading && !histState.loaded) {
      isAnyStoreLoading = true;
    }
    if (histState.error) {
      errors.push({ automation: auto, error: histState.error });
    }
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

  return {
    items,
    isLoading: isAnyStoreLoading,
    errors,
    activeSessions,
    hasLoadedSessions,
    conversationStatuses,
  };
}

function defaultTaskLookup(projectId: string, runId: string) {
  const taskId = getTaskIdForAutomationRun(projectId, runId);
  const taskStore = taskId ? getTaskStore(projectId, taskId) : undefined;
  const agentStatus = taskStore ? taskAgentStatus(taskStore) : null;
  return { taskId, taskStore, agentStatus };
}

export function resolveActivityItemStatus(
  item: ActivityItem,
  conversationStatuses: Map<string, AgentStatus>,
  activeSessions: Set<string>,
  hasLoadedSessions: boolean,
  taskLookup: (
    projectId: string,
    runId: string
  ) => {
    taskId: string | null;
    taskStore: TaskStore | undefined;
    agentStatus: AgentStatus | null;
  } = defaultTaskLookup
): {
  status: ActivityStatus;
  agentStatus: AgentStatus | null;
  taskId: string | null;
  taskStore: TaskStore | undefined;
} {
  const { taskId, taskStore, agentStatus: adoptedAgentStatus } = taskLookup(
    item.projectId,
    item.run.id
  );

  const convId = item.run.conversationId;
  const liveAgentStatus = convId ? conversationStatuses.get(convId) ?? null : null;
  const agentStatus = adoptedAgentStatus ?? liveAgentStatus;

  const isSessionActive = convId
    ? hasLoadedSessions
      ? activeSessions.has(convId)
      : undefined
    : false;

  const status = getActivityStatus(item.run.status, agentStatus, {
    hasTask: Boolean(taskId),
    isSessionActive,
  });

  return { status, agentStatus, taskId, taskStore };
}

interface ActivityViewProps {
  automations: Automation[];
  isLoading?: boolean;
  error?: unknown;
  onOpenAutomation: (automation: Automation) => void;
}

export const ActivityView = observer(function ActivityView({
  automations,
  isLoading,
  error,
  onOpenAutomation,
}: ActivityViewProps) {
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useSearchFocusHotkeys();

  const activity = useCrossProjectActivity(automations);
  const {
    items: allItems,
    isLoading: isActivityLoading,
    errors,
    activeSessions,
    hasLoadedSessions,
    conversationStatuses,
  } = activity;

  if (isLoading) {
    return (
      <div className="flex w-full items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        bare
        label="Failed to load automations."
        description={formatAutomationError(error)}
      />
    );
  }

  if (isActivityLoading && allItems.length === 0) {
    return (
      <div className="flex w-full items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (errors.length > 0 && allItems.length === 0) {
    return (
      <EmptyState
        bare
        label="Failed to load automation activity."
        description="Could not load run history from the remote runtime."
      />
    );
  }

  let activeCount = 0;
  let completedCount = 0;
  let failedCount = 0;

  const itemDetails = allItems.map((item) => {
    const details = resolveActivityItemStatus(
      item,
      conversationStatuses,
      activeSessions,
      hasLoadedSessions
    );
    if (
      details.status === 'working' ||
      details.status === 'queued' ||
      details.status === 'awaiting-input'
    ) {
      activeCount++;
    } else if (details.status === 'failed') {
      failedCount++;
    } else if (details.status === 'done') {
      completedCount++;
    }
    return { item, ...details };
  });

  const counts = {
    all: allItems.length,
    active: activeCount,
    completed: completedCount,
    failed: failedCount,
  };

  const query = searchQuery.trim().toLowerCase();
  const filteredItems = itemDetails.filter(({ item, taskStore, status }) => {
    if (filter === 'active') {
      if (status !== 'working' && status !== 'queued' && status !== 'awaiting-input') return false;
    } else if (filter === 'completed') {
      if (status !== 'done') return false;
    } else if (filter === 'failed') {
      if (status !== 'failed') return false;
    }

    if (!query) return true;

    const projectStore = getProjectStore(item.projectId);
    const projectName =
      (projectStore ? projectDisplayName(projectStore) : undefined) ?? item.projectId;
    const taskName = taskStore?.displayName ?? item.run.generatedName ?? '';

    return (
      item.automation.name.toLowerCase().includes(query) ||
      projectName.toLowerCase().includes(query) ||
      taskName.toLowerCase().includes(query)
    );
  });

  return (
    <div className="flex w-full flex-col gap-4">
      {errors.length > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>Failed to load run history for some automations.</span>
        </div>
      )}

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
          {filteredItems.map(({ item, status, agentStatus, taskId, taskStore }) => (
            <ActivityRow
              key={item.run.id}
              item={item}
              status={status}
              agentStatus={agentStatus}
              taskId={taskId}
              taskStore={taskStore}
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
  status: ActivityStatus;
  agentStatus: AgentStatus | null;
  taskId: string | null;
  taskStore: TaskStore | undefined;
  onOpenAutomation: (automation: Automation) => void;
}

export const ActivityRow = observer(function ActivityRow({
  item,
  status,
  agentStatus,
  taskId,
  taskStore,
  onOpenAutomation,
}: ActivityRowProps) {
  const { navigate } = useNavigate();
  const { run, automation, projectId } = item;
  const { adoptRun, isAdopting, runtimeAvailable } = useAutomationRunActions(
    automation.id,
    projectId
  );

  const task = taskId ? getRegisteredTaskData(projectId, taskId) : undefined;

  const interactive = Boolean(
    (taskId && !task?.archivedAt) ||
      (!taskId && runtimeAvailable && isAutomationRunAdoptable(run) && !isAdopting)
  );

  const projectStore = getProjectStore(projectId);
  const projectName = (projectStore ? projectDisplayName(projectStore) : undefined) ?? projectId;
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
              if (e.target !== e.currentTarget) return;
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
            onKeyDown={(e) => {
              e.stopPropagation();
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
              onKeyDown={(e) => {
                e.stopPropagation();
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
