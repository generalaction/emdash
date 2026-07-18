import {
  asMounted,
  getProjectStore,
} from '@core/features/projects/browser/stores/project-selectors';
import { getTaskManagerStore } from '@core/features/tasks/browser/stores/task-selectors';
import { openModal } from '@renderer/lib/modal/api';

export function selectedTaskCount(projectId: string | undefined): number {
  if (!projectId) return 0;
  return asMounted(getProjectStore(projectId))?.view.taskView.selectedIds.size ?? 0;
}

export async function deleteSelectedTasks(projectId: string): Promise<void> {
  const project = asMounted(getProjectStore(projectId));
  const taskManager = getTaskManagerStore(projectId);
  const taskView = project?.view.taskView;
  if (!taskManager || !taskView || taskView.selectedIds.size === 0) return;

  const selectedTasks = [...taskView.selectedIds].flatMap((id) => {
    const task = taskManager.tasks.get(id);
    return task ? [{ taskId: task.data.id, taskName: task.data.name }] : [];
  });
  if (selectedTasks.length === 0) return;

  const outcome = await openModal('deleteTaskModal', {
    projectId,
    tasks: selectedTasks,
  });
  if (!outcome.success) return;

  const { deleteWorktree, deleteBranch } = outcome.data;
  await taskManager.deleteTasks([...taskView.selectedIds], { deleteWorktree, deleteBranch });
  taskView.setSelectedIds(new Set());
}
