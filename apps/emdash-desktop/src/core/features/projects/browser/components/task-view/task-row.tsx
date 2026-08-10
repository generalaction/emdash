import { AgentStatus } from '@emdash/ui/react/components';
import { Checkbox, RelativeTime } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { StackedAgentLogos } from '@core/features/agents/contributions/browser/stacked-agent-logos';
import {
  taskAgentStatus,
  taskConversationStats,
} from '@core/features/conversations/api/browser/conversation-selectors';
import { getTaskGitCheckoutStore } from '@core/features/source-control/api/browser/stores/task-source-control-selectors';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { TaskContextMenu } from '@core/features/tasks/contributions/browser/task-context-menu';
import { TaskGitDiffStats } from '@core/features/tasks/contributions/browser/task-git-diff-stats';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { cn } from '@core/primitives/styling/browser/cn';
import { selectCurrentPr } from '@root/src/core/services/pull-requests/api';
import { PrBadge } from '@root/src/core/services/pull-requests/browser/components/pr-badge';
import { type ReadyTask, type TaskListViewModel } from './task-list-model';

/**
 * Row content for the project task list. The CollectionView shell owns row
 * click (navigation) and modifier-click selection; this component renders the
 * content, the hover-revealed checkbox, and the context menu.
 */
export const TaskRow = observer(function TaskRow({
  task,
  view,
}: {
  task: ReadyTask;
  view: TaskListViewModel;
}) {
  const { id } = view.useItem();
  const selection = view.useSelection();
  const openRename = useOpenModal('renameTaskModal');
  const openDeleteTask = useOpenModal('deleteTaskModal');
  const taskManager = getTaskManagerStore(task.data.projectId);

  const handleArchive = () => void taskManager?.archiveTask(task.data.id);
  const handleRestore = () => void taskManager?.restoreTask(task.data.id);
  const handleDelete = () => {
    void openDeleteTask({
      projectId: task.data.projectId,
      tasks: [{ taskId: task.data.id, taskName: task.data.name }],
    }).then((outcome) => {
      if (!outcome.success) return;
      const { deleteWorktree, deleteBranch, deleteConversations } = outcome.data;
      void taskManager?.deleteTasks([task.data.id], {
        deleteWorktree,
        deleteBranch,
        deleteConversations,
      });
    });
  };
  const handleRename = () => {
    void openRename({
      projectId: task.data.projectId,
      taskId: task.data.id,
      currentName: task.data.name,
    });
  };
  const isArchived = Boolean(task.data.archivedAt);
  const isSelected = selection.isSelected(id);
  const canPin = task.state !== 'unregistered';
  const agentAttention = taskAgentStatus(task);
  const currentPr = task.data.prs ? selectCurrentPr(task.data.prs) : undefined;
  const branchName =
    getTaskGitCheckoutStore(task.data.projectId, task.data.id)?.branchName ?? undefined;

  return (
    <TaskContextMenu
      isPinned={task.data.isPinned}
      canPin={canPin}
      isArchived={isArchived}
      branchName={branchName}
      onPin={() => void task.setPinned(true)}
      onUnpin={() => void task.setPinned(false)}
      onRename={handleRename}
      onArchive={handleArchive}
      onRestore={handleRestore}
      onConvertAutomation={undefined}
      onDelete={handleDelete}
    >
      <div className="group flex w-full items-center gap-2">
        {/*
          Mouse clicks land on the wrapper (the checkbox is pointer-events-none)
          so the real event's modifier keys reach `toggle`; keyboard activation
          reaches the focusable checkbox itself and toggles via onCheckedChange.
          The target check keeps the keyboard path from double-toggling through
          the synthetic click that bubbles up.
        */}
        <span
          onClick={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget) selection.toggle(id, event);
          }}
          className={cn(
            'inline-flex cursor-pointer transition-opacity focus-within:opacity-100',
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => selection.toggle(id)}
            className="pointer-events-none"
            aria-label="Select task"
          />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 truncate text-left text-sm">{task.data.name}</span>
          <TaskGitDiffStats task={task} className="shrink-0 text-xs" />
          {currentPr && <PrBadge pr={currentPr} />}
        </div>
        <StackedAgentLogos stats={taskConversationStats(task)} />
        <div
          className={cn(
            'flex min-w-8 shrink-0 items-center justify-end',
            agentAttention ? 'justify-end' : 'justify-middle'
          )}
        >
          {agentAttention ? (
            <AgentStatus status={agentAttention} tooltip />
          ) : (
            <RelativeTime
              value={task.data.createdAt}
              className="pr-1 font-sans text-xs text-foreground-passive"
              compact
            />
          )}
        </div>
      </div>
    </TaskContextMenu>
  );
});
