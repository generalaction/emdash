import { taskViewDef } from '@core/features/tasks/contributions/views';
import type { NavigationEvent } from '@core/primitives/navigation/browser/navigation-store';

export type TaskProjectRevealTarget = {
  projectId: string;
  taskId: string;
};

export function taskProjectRevealTarget(
  event: NavigationEvent
): TaskProjectRevealTarget | undefined {
  if (event.kind !== 'traversal' || event.to.viewId !== taskViewDef.id) return undefined;
  const { projectId, taskId } = event.to.params as {
    projectId?: string;
    taskId?: string;
  };
  return projectId && taskId ? { projectId, taskId } : undefined;
}
