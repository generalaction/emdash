import { useParams, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';

export function useIsActiveTask(taskId: string): boolean {
  const { currentView } = useWorkspaceSlots();
  const { params } = useParams('task');
  return currentView === 'task' && params.taskId === taskId;
}
