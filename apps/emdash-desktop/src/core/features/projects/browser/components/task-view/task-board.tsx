import { formatHostRef } from '@emdash/core/primitives/host/api';
import { AgentStatus } from '@emdash/ui/react/components';
import { Badge, Button, RelativeTime, toast } from '@emdash/ui/react/primitives';
import { GitBranch } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState, type DragEvent } from 'react';
import { hostRefFromConnectionId } from '@core/features/agents/api/browser/client';
import { useAgentMetadata } from '@core/features/agents/api/browser/use-agent-metadata';
import { useAgents } from '@core/features/agents/api/browser/use-agents';
import { StackedAgentLogos } from '@core/features/agents/contributions/browser/stacked-agent-logos';
import { getConversationsClient } from '@core/features/conversations/api/browser/client';
import {
  getConversationsForTask,
  taskConversationStats,
} from '@core/features/conversations/api/browser/conversation-selectors';
import { conversationTabKind } from '@core/features/conversations/api/browser/conversation-tab-kind';
import { nextDefaultConversationTitle } from '@core/features/conversations/api/browser/conversation-title-utils';
import { useConversationLaunchSettings } from '@core/features/conversations/api/browser/use-conversation-launch-settings';
import { useEffectiveProvider } from '@core/features/conversations/api/browser/use-effective-provider';
import {
  getProjectSshConnectionId,
  getProjectViewStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import {
  getTaskGitCheckoutStore,
  getTaskPrAssociationStore,
} from '@core/features/source-control/api/browser/stores/task-source-control-selectors';
import {
  getTaskManagerStore,
  taskHostActionAvailability,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { agentSupportsAcp, agentSupportsInitialPromptDelivery } from '@core/primitives/agents/api';
import { buildIssueContextText } from '@core/primitives/issues/api';
import { linkedIssueDisplayIdentifier } from '@core/primitives/linked-issues/api';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { isRegistered } from '@core/primitives/task-state/browser/task-state';
import { selectCurrentPr } from '@core/services/pull-requests/api/repository';
import {
  BOARD_COLUMNS,
  boardAgentStatusKey,
  boardConversation,
  boardLastActivity,
  taskBoardColumn,
  type BoardColumn,
} from './task-board-model';
import type { ReadyTask } from './task-list-model';

const TASK_DRAG_TYPE = 'application/x-emdash-task';

const TaskBoardCard = observer(function TaskBoardCard({
  task,
  column,
  onDragStart,
}: {
  task: ReadyTask;
  column: BoardColumn;
  onDragStart: (event: DragEvent<HTMLLIElement>, taskId: string) => void;
}) {
  const { navigate } = useNavigate();
  const [opening, setOpening] = useState(false);
  const { data: agents } = useAgentMetadata();
  const { projectId, id: taskId, linkedIssue } = task.data;
  const manager = getConversationsForTask(taskId);
  const conversations = [...(manager?.conversations.values() ?? [])];
  const conversation = boardConversation(conversations);
  const stats = taskConversationStats(task);
  const agentNames = Object.keys(stats).map((id) => agents?.find((a) => a.id === id)?.name ?? id);
  const pr = selectCurrentPr(getTaskPrAssociationStore(task).pullRequests);
  const branch =
    getTaskGitCheckoutStore(projectId, taskId)?.branchName ??
    task.workspaceObservedPr?.branch ??
    pr?.headRefName;
  const issueKey = linkedIssue && linkedIssueDisplayIdentifier(linkedIssue);
  const title = linkedIssue?.title || task.data.name;
  const archived = Boolean(task.data.archivedAt);

  const open = async () => {
    setOpening(true);
    try {
      // Archived tasks have no operational stores. Use the existing Restore operation first.
      if (archived) await getTaskManagerStore(projectId)?.restoreTask(taskId);
      const composition = getTaskComposition(projectId, taskId);
      if (composition) {
        await composition.space.ready;
        const currentManager = getConversationsForTask(taskId);
        await currentManager?.list.load();
        const target = boardConversation([...(currentManager?.conversations.values() ?? [])]);
        if (target) {
          composition.paneLayout.open(
            conversationTabKind(target.data.type),
            { conversationId: target.data.id },
            { preview: false }
          );
        }
      }
      navigate(taskViewDef({ projectId, taskId }));
    } catch (error) {
      toast.error('Could not open task', { description: String(error) });
    } finally {
      setOpening(false);
    }
  };

  return (
    <li className="shrink-0" draggable onDragStart={(event) => onDragStart(event, taskId)}>
      <Button
        variant="secondary"
        disabled={opening}
        onClick={() => void open()}
        aria-label={`${archived ? 'Restore and open' : 'Open'} ${issueKey ? `${issueKey}: ` : ''}${title}`}
        className="w-full"
        style={{ height: 'auto' }}
      >
        <div className="flex w-full min-w-0 flex-col gap-3 py-3 text-left whitespace-normal">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {linkedIssue?.provider === 'jira' && <Badge tone="purple">Jira</Badge>}
              <span className="truncate text-xs text-foreground-muted">
                {issueKey || 'No linked issue'}
              </span>
            </div>
            <AgentStatus status={conversation?.status ?? null} />
          </div>
          <span className="line-clamp-3 text-sm font-medium">{title}</span>
          {(column === 'Awaiting Input' || column === 'Review') && (
            <div>
              <Badge>{column}</Badge>
            </div>
          )}
          {linkedIssue && title !== task.data.name && (
            <span className="truncate text-xs text-foreground-muted">{task.data.name}</span>
          )}
          <div className="flex items-center gap-2">
            <StackedAgentLogos stats={stats} />
            <span className="truncate text-xs text-foreground-muted">
              {agentNames.join(', ') || 'No agent'}
            </span>
          </div>
          <span
            className="flex items-center gap-1 text-xs text-foreground-muted"
            title={branch ?? undefined}
          >
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{branch || 'Branch unavailable'}</span>
          </span>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground-passive">
            <span title="Latest saved task update or conversation interaction; not every agent output">
              Activity{' '}
              <RelativeTime value={boardLastActivity(task.data, conversations)} compact ago />
            </span>
            {pr && <span>PR {pr.status}</span>}
          </div>
          {archived && (
            <span className="text-xs text-foreground-muted">Archived · Restore and open</span>
          )}
        </div>
      </Button>
    </li>
  );
});

export const TaskBoard = observer(function TaskBoard({ projectId }: { projectId: string }) {
  const manager = getTaskManagerStore(projectId);
  const view = getProjectViewStore(projectId);
  const connectionId = getProjectSshConnectionId(projectId);
  const hostRef = hostRefFromConnectionId(connectionId);
  const host = formatHostRef(hostRef);
  const { providerId, createDisabled } = useEffectiveProvider(connectionId);
  const { data: agents } = useAgents(hostRef);
  const selectedAgent = agents?.find((agent) => agent.id === providerId);
  const launchSettings = useConversationLaunchSettings(
    host,
    providerId,
    selectedAgent?.capabilities
  );
  const confirmArchive = useOpenModal('confirmActionModal');
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  if (!manager) return null;

  const taskColumn = (task: ReadyTask): BoardColumn => {
    const conversations = [
      ...(getConversationsForTask(task.data.id)?.conversations.values() ?? []),
    ];
    const pr = selectCurrentPr(getTaskPrAssociationStore(task).pullRequests);
    const actual = taskBoardColumn(task.data, conversations, pr);
    if (actual === 'Done') return actual;
    return view?.boardOverride(task.data.id, boardAgentStatusKey(conversations)) ?? actual;
  };

  const startAgent = async (task: ReadyTask) => {
    if (taskHostActionAvailability(projectId).kind === 'disabled') {
      throw new Error('The project host is unavailable. Reconnect it and try again.');
    }
    if (!providerId || createDisabled || !launchSettings.ready || !selectedAgent) {
      throw new Error('No ready agent is available. Select and install a default agent first.');
    }
    const outcome = await manager.provisionTask(task.data.id);
    if (outcome.kind !== 'active') throw new Error('The task workspace could not be activated.');
    const current = manager.tasks.get(task.data.id);
    if (current?.state !== 'provisioned') throw new Error('The task workspace is not ready.');
    await current.ready();
    const conversations = getConversationsForTask(task.data.id);
    if (!conversations) throw new Error('The task conversations are not ready.');

    const issue = task.data.linkedIssue;
    const prompt = issue
      ? `Work on ${linkedIssueDisplayIdentifier(issue) ?? issue.identifier}: ${issue.title}`
      : `Work on this task: ${task.data.name}`;
    const context = issue ? buildIssueContextText(issue) : undefined;
    const canUseInitialPtyPrompt = agentSupportsInitialPromptDelivery(selectedAgent.capabilities);
    const type =
      agentSupportsAcp(selectedAgent.capabilities) &&
      (launchSettings.useChatUi || !canUseInitialPtyPrompt)
        ? 'acp'
        : 'pty';
    if (type === 'pty' && !canUseInitialPtyPrompt) {
      throw new Error('This agent cannot receive a task prompt in the terminal interface.');
    }
    const id = crypto.randomUUID();
    await conversations.createConversation({
      id,
      projectId,
      taskId: task.data.id,
      provider: providerId,
      title: nextDefaultConversationTitle(
        providerId,
        [...conversations.conversations.values()].map((conversation) => conversation.data)
      ),
      type,
      ...(type === 'acp'
        ? {
            options: launchSettings.settings.acp.options,
            initialQueue: [{ text: prompt, ...(context && { hiddenContext: context }) }],
          }
        : {
            autoApprove: launchSettings.autoApprove,
            initialPrompt: context ? `${context}\n\n${prompt}` : prompt,
          }),
    });
    const startedConversations = [...conversations.conversations.values()];
    const actual = taskBoardColumn(
      task.data,
      startedConversations,
      selectCurrentPr(getTaskPrAssociationStore(task).pullRequests)
    );
    if (actual === 'Backlog') {
      view?.setBoardOverride(task.data.id, 'Running', boardAgentStatusKey(startedConversations));
    }
    if (type === 'acp') {
      try {
        const started = await (
          await getConversationsClient()
        ).acp.startSession({
          conversationId: id,
          mode: 'fresh',
        });
        if (!started.success) throw new Error('The agent session could not start.');
      } catch (error) {
        view?.setBoardOverride(task.data.id, null);
        throw error;
      }
    }
  };

  const moveTask = async (taskId: string, destination: BoardColumn) => {
    const task = manager.tasks.get(taskId);
    if (!task || !isRegistered(task) || task.data.type === 'automation-run') return;
    const source = taskColumn(task);
    if (source === destination || movingTaskId || task.data.archivedAt) return;
    setMovingTaskId(taskId);
    try {
      if (destination === 'Done') {
        const confirmed = await confirmArchive({
          title: 'Archive task?',
          description: `Archive "${task.data.name}"? Its worktree will be preserved.`,
          confirmLabel: 'Archive',
        });
        if (!confirmed.success) return;
        await manager.archiveTask(taskId);
        view?.setBoardOverride(taskId, null);
        return;
      }
      if (source === 'Backlog' && destination === 'Running') {
        await startAgent(task);
        return;
      }
      const conversations = [...(getConversationsForTask(taskId)?.conversations.values() ?? [])];
      view?.setBoardOverride(taskId, destination, boardAgentStatusKey(conversations));
    } catch (error) {
      toast.error('Could not move task', { description: String(error) });
    } finally {
      setMovingTaskId(null);
    }
  };

  const dragStart = (event: DragEvent<HTMLLIElement>, taskId: string) => {
    event.dataTransfer.setData(TASK_DRAG_TYPE, taskId);
    event.dataTransfer.effectAllowed = 'move';
    setDraggingTaskId(taskId);
  };

  const drop = (event: DragEvent<HTMLElement>, column: BoardColumn) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData(TASK_DRAG_TYPE);
    setDraggingTaskId(null);
    if (taskId) void moveTask(taskId, column);
  };

  // Match the project task list: omit optimistic rows and automation runs, include archived tasks.
  const tasks = [...manager.tasks.values()].filter(
    (task): task is ReadyTask =>
      task.state !== 'unregistered' && task.data.type !== 'automation-run'
  );
  const columns = BOARD_COLUMNS.map((column) => ({
    column,
    tasks: tasks.filter((task) => taskColumn(task) === column),
  }));

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col gap-3"
      onDragEnd={() => setDraggingTaskId(null)}
    >
      <p className="text-xs text-foreground-muted">
        Live agent and pull request status. Questions, permissions, and errors need input; completed
        turns and open pull requests appear in Review.
      </p>
      <div
        className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto pb-2"
        aria-label="Task board"
      >
        {columns.map(({ column, tasks: columnTasks }) => (
          <section
            key={column}
            aria-label={column}
            onDragOver={(event) => {
              if (!draggingTaskId) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(event) => drop(event, column)}
            className="flex min-h-0 min-w-56 flex-1 flex-col rounded-lg border border-border bg-background-2/30"
          >
            <h2 className="flex items-center justify-between gap-2 p-3 text-sm font-medium">
              {column} <Badge>{columnTasks.length}</Badge>
            </h2>
            <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {columnTasks.map((task) => (
                <TaskBoardCard
                  key={task.data.id}
                  task={task}
                  column={column}
                  onDragStart={dragStart}
                />
              ))}
              {columnTasks.length === 0 && (
                <li className="p-3 text-xs text-foreground-passive">No tasks</li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
});
