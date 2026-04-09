import { observer } from 'mobx-react-lite';
import { type Task } from '@shared/tasks';
import AgentLogo from '@renderer/components/agent-logo';
import { AgentStatusIndicator } from '@renderer/components/agent-status-indicator';
import { PrBadge } from '@renderer/components/pr-badge';
import { Checkbox } from '@renderer/components/ui/checkbox';
import { RelativeTime } from '@renderer/components/ui/relative-time';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { type TaskStore } from '@renderer/core/stores/task';
import { getTaskManagerStore, taskAgentStatus } from '@renderer/core/stores/task-selectors';
import { TaskContextMenu } from '@renderer/core/tasks/components/task-context-menu';
import { TaskGitDiffStats } from '@renderer/core/tasks/components/task-git-diff-stats';
import { useNavigate } from '@renderer/core/view/navigation-provider';
import { agentConfig } from '@renderer/lib/agentConfig';
import { cn } from '@renderer/lib/utils';

export type ReadyTask = TaskStore & { data: Task };

export const TaskRow = observer(function TaskRow({
  task,
  isSelected,
  onToggleSelect,
}: {
  task: ReadyTask;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const { navigate } = useNavigate();
  const showRename = useShowModal('renameTaskModal');
  const showConfirm = useShowModal('confirmActionModal');
  const taskManager = getTaskManagerStore(task.data.projectId);

  const handleArchive = () => void taskManager?.archiveTask(task.data.id);
  const handleRestore = () => void taskManager?.restoreTask(task.data.id);
  const handleProvision = () => void taskManager?.provisionTask(task.data.id);
  const handleDelete = () =>
    showConfirm({
      title: 'Delete task',
      description: `"${task.data.name}" will be permanently deleted. This action cannot be undone.`,
      confirmLabel: 'Delete',
      onSuccess: () => void taskManager?.deleteTask(task.data.id),
    });
  const handleRename = () =>
    showRename({
      projectId: task.data.projectId,
      taskId: task.data.id,
      currentName: task.data.name,
    });

  const isArchived = Boolean(task.data.archivedAt);
  const canPin = task.state !== 'unregistered';
  const agentAttention = taskAgentStatus(task);

  return (
    <TaskContextMenu
      isPinned={task.data.isPinned}
      canPin={canPin}
      isArchived={isArchived}
      onPin={() => void task.setPinned(true)}
      onUnpin={() => void task.setPinned(false)}
      onRename={handleRename}
      onArchive={handleArchive}
      onRestore={handleRestore}
      onDelete={handleDelete}
    >
      <button
        onClick={() => {
          handleProvision();
          navigate('task', { projectId: task.data.projectId, taskId: task.data.id });
        }}
        className="group flex items-center gap-2 rounded-lg p-3  hover:bg-background-1 transition-colors w-full"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'transition-opacity',
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={onToggleSelect}
            aria-label="Select task"
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="min-w-0 text-left text-sm truncate">{task.data.name}</span>
            <TaskGitDiffStats task={task} className="text-xs shrink-0" />
            {task.data.prs && task.data.prs.length > 0 && <PrBadge pr={task.data.prs[0]} />}
          </div>
        </div>
        <div className="flex items-center shrink-0 [&>span]:ring-2 [&>span]:ring-background [&>span:not(:first-child)]:-ml-1.5">
          {Object.entries(task.conversationStats).map(([providerId, count]) => {
            const config = agentConfig[providerId as keyof typeof agentConfig];
            if (!config) return null;
            return (
              <span
                key={providerId}
                className="relative flex items-center justify-center h-5 w-5 rounded-sm bg-background-2 overflow-hidden"
                title={`${config.name}: ${String(count)}`}
              >
                <AgentLogo
                  logo={config.logo}
                  alt={config.alt}
                  isSvg={config.isSvg}
                  invertInDark={config.invertInDark}
                  className="h-3.5 w-3.5"
                />
                {count > 1 && (
                  <span className="absolute -bottom-px -right-px text-[8px] leading-none font-semibold bg-background text-foreground-passive px-px rounded-tl">
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
              className="text-xs text-foreground-passive font-mono pr-1"
              compact
            />
          )}
        </div>
      </button>
    </TaskContextMenu>
  );
});
