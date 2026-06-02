import { observer } from 'mobx-react-lite';
import { useRef } from 'react';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { TaskContextMenu } from '@renderer/features/tasks/components/task-context-menu';
import { TaskGitDiffStats } from '@renderer/features/tasks/components/task-git-diff-stats';
import {
  getTaskGitStore,
  getTaskManagerStore,
  taskAgentStatus,
} from '@renderer/features/tasks/stores/task-selectors';
import { type TaskStore } from '@renderer/features/tasks/stores/task-store';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { PrBadge } from '@renderer/lib/components/pr-badge';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { selectCurrentPr } from '@shared/pull-requests';
import { type Task } from '@shared/tasks';

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
  const showRename = useShowModal('renameTaskModal');
  const showDeleteTask = useShowModal('deleteTaskModal');
  const taskManager = getTaskManagerStore(task.data.projectId);
  const shiftKeyRef = useRef(false);

  const handleArchive = () => void taskManager?.archiveTask(task.data.id);
  const handleRestore = () => void taskManager?.restoreTask(task.data.id);
  const handleProvision = () => void taskManager?.provisionTask(task.data.id);
  const handleDelete = () =>
    showDeleteTask({
      projectId: task.data.projectId,
      tasks: [{ taskId: task.data.id, taskName: task.data.name }],
      onSuccess: ({ deleteWorktree, deleteBranch }) =>
        void taskManager?.deleteTasks([task.data.id], { deleteWorktree, deleteBranch }),
    });
  const handleRename = () =>
    showRename({
      projectId: task.data.projectId,
      taskId: task.data.id,
      currentName: task.data.name,
    });
  const handleConvertAutomation = () => void task.convertAutomationTask();

  const isArchived = Boolean(task.data.archivedAt);
  const canPin = task.state !== 'unregistered';
  const agentAttention = taskAgentStatus(task);
  const currentPr = task.data.prs ? selectCurrentPr(task.data.prs) : undefined;
  const branchName = getTaskGitStore(task.data.projectId, task.data.id)?.branchName ?? undefined;

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
      onConvertAutomation={task.data.automationId ? handleConvertAutomation : undefined}
      onDelete={handleDelete}
    >
      <button
        onClick={() => {
          if (isArchived) return;
          handleProvision();
          navigate('task', { projectId: task.data.projectId, taskId: task.data.id });
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
        <div className="flex shrink-0 items-center [&>span]:ring-2 [&>span]:ring-background [&>span:not(:first-child)]:-ml-1.5">
          {Object.entries(task.conversationStats).map(([providerId, count]) => {
            const config = agentConfig[providerId as keyof typeof agentConfig];
            if (!config) return null;
            return (
              <span
                key={providerId}
                className="relative flex h-5 w-5 items-center justify-center overflow-hidden rounded-sm bg-background-2"
                title={`${config.name}: ${String(count)}`}
              >
                <AgentLogo
                  logo={config.logo}
                  logoDark={config.logoDark}
                  alt={config.alt}
                  isSvg={config.isSvg}
                  invertInDark={config.invertInDark}
                  className="h-3.5 w-3.5"
                />
                {count > 1 && (
                  <span className="absolute -right-px -bottom-px rounded-tl bg-background px-px text-[8px] leading-none font-semibold text-foreground-passive">
                    {count}
                  </span>
                )}
              </span>
            );
          })}
        </div>
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
              className="pr-1 font-mono text-xs text-foreground-passive"
              compact
            />
          )}
        </div>
      </button>
    </TaskContextMenu>
  );
});
