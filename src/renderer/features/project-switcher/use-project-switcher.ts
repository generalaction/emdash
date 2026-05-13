import { getSwitcherTasks } from './get-switcher-tasks';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';

export function useProjectSwitcher() {
  const { navigate } = useNavigate();

  const switchTask = (direction: 1 | -1) => {
    const nav = appState.navigation;
    const navParams = nav.viewParamsStore['task'] as { taskId?: string } | undefined;
    const currentTaskId = nav.currentViewId === 'task' ? navParams?.taskId : undefined;

    const allTasks = getSwitcherTasks();
    if (allTasks.length === 0) return;

    const currentIdx = allTasks.findIndex((t) => t.data.id === currentTaskId);
    const nextIdx = currentIdx === -1 ? 0 : (currentIdx + direction + allTasks.length) % allTasks.length;
    const target = allTasks[nextIdx];
    navigate('task', { projectId: target.projectId, taskId: target.data.id });
  };

  return {
    switchToNext: () => switchTask(1),
    switchToPrev: () => switchTask(-1),
  };
}
