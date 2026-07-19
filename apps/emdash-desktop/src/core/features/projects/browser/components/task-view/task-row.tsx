import { observer } from 'mobx-react-lite';
import { useRef } from 'react';
import {
  taskAgentStatus,
  taskConversationStats,
} from '@core/features/conversations/browser/conversation-selectors';
import { getTaskGitCheckoutStore } from '@core/features/source-control/browser/stores/task-source-control-selectors';
import { TaskContextMenu } from '@core/features/tasks/browser/components/task-context-menu';
import { TaskGitDiffStats } from '@core/features/tasks/browser/components/task-git-diff-stats';
import { getTaskManagerStore } from '@core/features/tasks/browser/stores/task-selectors';
import { type TaskStore } from '@core/features/tasks/browser/stores/task-store';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { type Task } from '@core/primitives/tasks/api';
import { AgentStatusIndicator } from '@renderer/lib/components/agent-status-indicator';
import { PrBadge } from '@renderer/lib/components/pr-badge';
import { StackedAgentLogos } from '@renderer/lib/components/stacked-agent-logos';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useOpenModal } from '@renderer/lib/modal/api';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { cn } from '@renderer/utils/utils';
import { selectCurrentPr } from '@root/src/core/services/pull-requests/api';

export type ReadyTask = TaskStore & { data: Task };

export const TaskRow = observer(function TaskRow({
  task,
  isSelected,
  onToggleSelect,
}: {
  task: ReadyTask;
  isSelected: boolean;
  onToggleSelect: (shiftKey: boolean) => void;
}) {
  const { navigate } = useNavigate();
  const openRename = useOpenModal('renameTaskModal');
  const openDeleteTask = useOpenModal('deleteTaskModal');
  const taskManager = getTaskManagerStore(task.data.projectId);
  const shiftKeyRef = useRef(false);

  const handleArchive = () => void taskManager?.archiveTask(task.data.id);
  const handleRestore = () => void taskManager?.restoreTask(task.data.id);
  const handleProvision = () => void taskManager?.provisionTask(task.data.id);
  const handleDelete = () => {
    void openDeleteTask({
      projectId: task.data.projectId,
      tasks: [{ taskId: task.data.id, taskName: task.data.name }],
    }).then((outcome) => {
      if (!outcome.success) return;
      const { deleteWorktree, deleteBranch } = outcome.data;
      void taskManager?.deleteTasks([task.data.id], { deleteWorktree, deleteBranch });
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
      <button
        onClick={() => {
          if (isArchived) return;
          handleProvision();
          navigate(taskViewDef({ projectId: task.data.projectId, taskId: task.data.id }));
        }}
        className="group flex w-full items-center gap-2 rounded-lg p-3 transition-colors hover:bg-background-1"
      >
        <div
          onPointerDownCapture={(e) => {
            shiftKeyRef.current = e.shiftKey;
          }}
          onKeyDownCapture={(e) => {
            shiftKeyRef.current = e.shiftKey;
          }}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'transition-opacity',
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => {
              const shift = shiftKeyRef.current;
              shiftKeyRef.current = false;
              onToggleSelect(shift);
            }}
            aria-label="Select task"
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="min-w-0 truncate text-left text-sm">{task.data.name}</span>
            <TaskGitDiffStats task={task} className="shrink-0 text-xs" />
            {currentPr && <PrBadge pr={currentPr} />}
          </div>
        </div>
        <StackedAgentLogos stats={taskConversationStats(task)} />
        <div
          className={cn(
            'flex min-w-8 shrink-0 items-center justify-end',
            agentAttention ? 'justify-end' : 'justify-middle'
          )}
        >
          {agentAttention ? (
            <AgentStatusIndicator status={agentAttention} />
          ) : (
            <RelativeTime
              value={task.data.createdAt}
              className="pr-1 font-sans text-xs text-foreground-passive"
              compact
            />
          )}
        </div>
      </button>
    </TaskContextMenu>
  );
});
