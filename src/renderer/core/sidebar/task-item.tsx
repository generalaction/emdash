import { observer } from 'mobx-react-lite';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { TaskSidebarAgentStatus } from '@renderer/core/sidebar/task-sidebar-agent-status';
import { TaskStore } from '@renderer/core/stores/task';
import { getTaskManagerStore, getTaskStore } from '@renderer/core/stores/task-selectors';
import { TaskContextMenu } from '@renderer/core/tasks/components/task-context-menu';
import { TaskGitDiffStats } from '@renderer/core/tasks/components/task-git-diff-stats';
import { useNavigate, useParams, useWorkspaceSlots } from '@renderer/core/view/navigation-provider';
import { cn } from '@renderer/lib/utils';
import { PrBadge } from '../../components/pr-badge';
import { SidebarMenuRow } from './sidebar-primitives';

interface SidebarTaskItemProps {
  taskId: string;
  projectId: string;
  /** Pinned strip uses tighter padding than tasks nested under a project. */
  rowVariant?: 'underProject' | 'pinned';
}

export const SidebarTaskItem = observer(function SidebarTaskItem({
  taskId,
  projectId,
  rowVariant = 'underProject',
}: SidebarTaskItemProps) {
  const { navigate } = useNavigate();
  const showRename = useShowModal('renameTaskModal');
  const showConfirm = useShowModal('confirmActionModal');

  const { currentView } = useWorkspaceSlots();
  const { params } = useParams('task');
  const isActive =
    currentView === 'task' && params.taskId === taskId && params.projectId === projectId;

  const task = getTaskStore(projectId, taskId)!;
  const taskManager = getTaskManagerStore(projectId);

  const isBootstrapping =
    task.state === 'unregistered' ||
    (task.state === 'unprovisioned' &&
      (task.phase === 'provision' || task.phase === 'provision-error'));

  const taskName = task.data.name;

  const handleProvision = () => {
    if (task.state !== 'unprovisioned' || task.phase !== 'idle') return;
    taskManager?.provisionTask(taskId);
  };

  const handleArchive = () => void taskManager?.archiveTask(taskId);

  const handleRename = () => showRename({ projectId, taskId, currentName: taskName });

  const handleDelete = () =>
    showConfirm({
      title: 'Delete task',
      description: `"${taskName}" will be permanently deleted. This action cannot be undone.`,
      confirmLabel: 'Delete',
      onSuccess: () => {
        void taskManager?.deleteTask(taskId);
        if (isActive) navigate('project', { projectId });
      },
    });

  const canPin = task.state !== 'unregistered';

  return (
    <TaskContextMenu
      isPinned={task.data.isPinned}
      canPin={canPin}
      isArchived={false}
      onPin={() => void task.setPinned(true)}
      onUnpin={() => void task.setPinned(false)}
      onRename={handleRename}
      onArchive={handleArchive}
      onDelete={handleDelete}
    >
      <SidebarMenuRow
        className={cn(
          'group/row flex items-center justify-between px-1 h-8 gap-1',
          rowVariant === 'pinned' ? 'pl-2' : 'pl-8'
        )}
        isActive={isActive}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          handleProvision();
          navigate('task', { projectId, taskId });
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 self-stretch overflow-hidden">
          <span
            className={cn(
              'min-w-0 truncate text-left transition-colors',
              isBootstrapping && 'text-foreground/40'
            )}
          >
            {taskName}
          </span>
          <TaskGitDiffStats task={task} className="h-full shrink-0 flex items-center pr-1" />
          <RenderPrBadge task={task} />
        </div>
        <TaskSidebarAgentStatus task={task} />
      </SidebarMenuRow>
    </TaskContextMenu>
  );
});

const RenderPrBadge = observer(function RenderPrBadge({ task }: { task: TaskStore }) {
  if (!('prs' in task.data)) return null;
  return task.data.prs.length > 0 ? <PrBadge variant="compact" pr={task.data.prs[0]} /> : null;
});
