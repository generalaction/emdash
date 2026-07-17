import { taskViewDef } from '@core/features/tasks/contributions/views';
import { useViewParams, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';

export function useIsActiveTask(taskId: string): boolean {
  const { currentView } = useWorkspaceSlots();
  const params = useViewParams(taskViewDef);
  return currentView === 'task' && params?.taskId === taskId;
}
