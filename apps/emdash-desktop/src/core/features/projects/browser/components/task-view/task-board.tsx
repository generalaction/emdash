import { AgentStatus } from '@emdash/ui/react/components';
import { Badge, Button, RelativeTime, toast } from '@emdash/ui/react/primitives';
import { GitBranch } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useAgentMetadata } from '@core/features/agents/api/browser/use-agent-metadata';
import { StackedAgentLogos } from '@core/features/agents/contributions/browser/stacked-agent-logos';
import {
  getConversationsForTask,
  taskConversationStats,
} from '@core/features/conversations/api/browser/conversation-selectors';
import { conversationTabKind } from '@core/features/conversations/api/browser/conversation-tab-kind';
import {
  getTaskGitCheckoutStore,
  getTaskPrAssociationStore,
} from '@core/features/source-control/api/browser/stores/task-source-control-selectors';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { linkedIssueDisplayIdentifier } from '@core/primitives/linked-issues/api';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { selectCurrentPr } from '@core/services/pull-requests/api/repository';
import {
  BOARD_COLUMNS,
  boardConversation,
  boardLastActivity,
  taskBoardColumn,
} from './task-board-model';
import type { ReadyTask } from './task-list-model';

const TaskBoardCard = observer(function TaskBoardCard({ task }: { task: ReadyTask }) {
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
    <li className="shrink-0">
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
            <span className="truncate text-xs text-foreground-muted">
              {issueKey || 'No linked issue'}
            </span>
            <AgentStatus status={conversation?.status ?? null} />
          </div>
          <span className="line-clamp-3 text-sm font-medium">{title}</span>
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
  if (!manager) return null;

  // Match the project task list: omit optimistic rows and automation runs, include archived tasks.
  const tasks = [...manager.tasks.values()].filter(
    (task): task is ReadyTask =>
      task.state !== 'unregistered' && task.data.type !== 'automation-run'
  );
  const columns = BOARD_COLUMNS.map((column) => ({
    column,
    tasks: tasks.filter((task) => {
      const conversations = [
        ...(getConversationsForTask(task.data.id)?.conversations.values() ?? []),
      ];
      const pr = selectCurrentPr(getTaskPrAssociationStore(task).pullRequests);
      return taskBoardColumn(task.data, conversations, pr) === column;
    }),
  }));

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      <p className="text-xs text-foreground-muted">
        Live agent and pull request status. Errors need input; started idle sessions appear in
        Review.
      </p>
      <div
        className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto pb-2"
        aria-label="Task board"
      >
        {columns.map(({ column, tasks: columnTasks }) => (
          <section
            key={column}
            aria-label={column}
            className="flex min-h-0 min-w-56 flex-1 flex-col rounded-lg border border-border bg-background-2/30"
          >
            <h2 className="flex items-center justify-between gap-2 p-3 text-sm font-medium">
              {column} <Badge>{columnTasks.length}</Badge>
            </h2>
            <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {columnTasks.map((task) => (
                <TaskBoardCard key={task.data.id} task={task} />
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
