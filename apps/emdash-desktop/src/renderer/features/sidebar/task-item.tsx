import { observer } from 'mobx-react-lite';
import { TaskSidebarTrailingSlot } from '@renderer/features/sidebar/task-sidebar-agent-status';
import { TaskContextMenu } from '@renderer/features/tasks/components/task-context-menu';
import { TaskGitDiffStats } from '@renderer/features/tasks/components/task-git-diff-stats';
import {
  getTaskGitWorktreeStore,
  getTaskManagerStore,
  getTaskStore,
  getWorkspaceForTask,
} from '@renderer/features/tasks/stores/task-selectors';
import { type TaskStore } from '@renderer/features/tasks/stores/task-store';
import {
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { cn } from '@renderer/utils/utils';
import { selectCurrentPr } from '@shared/core/pull-requests/pull-requests';
import { PrBadge } from '../../lib/components/pr-badge';
import { useAppSettingsKey } from '../settings/use-app-settings-key';
import { SidebarMenuAction, SidebarMenuRow } from './sidebar-primitives';

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
  const showDeleteTask = useShowModal('deleteTaskModal');

  const { currentView } = useWorkspaceSlots();
  const { params } = useParams('task');
  const { value: interfaceSettings } = useAppSettingsKey('interface');
  const isActive =
    currentView === 'task' && params.taskId === taskId && params.projectId === projectId;

  const task = getTaskStore(projectId, taskId)!;
  const taskManager = getTaskManagerStore(projectId);

  const taskName = task.data.name;

  const handleProvision = () => {
    if (task.state !== 'unprovisioned' || task.phase !== 'idle') return;
    void taskManager?.provisionTask(taskId);
  };

  const openTask = () => {
    handleProvision();
    navigate('task', { projectId, taskId });
  };

  const handleArchive = () => {
    if (isActive) navigate('project', { projectId });
    void taskManager?.archiveTask(taskId);
  };

  const handleRename = () => showRename({ projectId, taskId, currentName: taskName });

  const handleDelete = () =>
    showDeleteTask({
      projectId,
      tasks: [{ taskId, taskName }],
      onSuccess: ({ deleteWorktree, deleteBranch }) => {
        void taskManager?.deleteTasks([taskId], { deleteWorktree, deleteBranch });
        if (isActive) navigate('project', { projectId });
      },
    });

  const canPin = task.state !== 'unregistered';

  const workspaceStore = getWorkspaceForTask(projectId, taskId);
  const git = getTaskGitWorktreeStore(projectId, taskId);
  const showLineChanges = interfaceSettings?.showLeftSidebarLineChanges ?? true;
  const showPrStatus = interfaceSettings?.showLeftSidebarPrStatus ?? true;
  const showTimestamps = interfaceSettings?.showLeftSidebarTimestamps ?? true;
  const branchName = git?.branchName ?? undefined;
  const handleReconnect =
    workspaceStore?.connectionState != null ? () => workspaceStore.reconnect() : undefined;

  return (
    <TaskContextMenu
      isPinned={task.data.isPinned}
      canPin={canPin}
      isArchived={false}
      branchName={branchName}
      onPin={() => void task.setPinned(true)}
      onUnpin={() => void task.setPinned(false)}
      onRename={handleRename}
      onArchive={handleArchive}
      onReconnect={handleReconnect}
      onConvertAutomation={undefined}
      onDelete={handleDelete}
    >
      <SidebarMenuRow
        className={cn(
          'group/row flex items-center justify-between px-1 h-8 gap-1',
          rowVariant === 'pinned' ? 'pl-2' : 'pl-8'
        )}
        isActive={isActive}
        onMouseDown={(e) => e.preventDefault()}
        onClick={openTask}
      >
        <SidebarMenuAction
          aria-label={`Open task ${taskName || 'task'}`}
          className="gap-1 overflow-hidden"
        >
          <span
            className={cn(
              'min-w-0 truncate text-left transition-colors',
              task.isBootstrapping && 'text-foreground/40'
            )}
          >
            {taskName}
          </span>
        </SidebarMenuAction>
        <div className="ml-2 flex shrink-0 items-center justify-end gap-1.5">
          {showLineChanges && <TaskGitDiffStats task={task} />}
          {showPrStatus && <RenderPrBadge task={task} />}
          <TaskSidebarTrailingSlot task={task} showTimestamp={showTimestamps} />
        </div>
      </SidebarMenuRow>
    </TaskContextMenu>
  );
});

const RenderPrBadge = observer(function RenderPrBadge({ task }: { task: TaskStore }) {
  if (!('prs' in task.data)) return null;
  const pr = selectCurrentPr(task.data.prs);
  return pr ? (
    <span onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <PrBadge variant="compact" pr={pr} hoverDelay={100} />
    </span>
  ) : null;
});
