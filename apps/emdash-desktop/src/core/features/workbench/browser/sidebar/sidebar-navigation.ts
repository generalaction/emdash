import type { Emitter, Unsubscribe } from '@emdash/shared';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import type { NavigationEvent } from '@core/primitives/navigation/browser/navigation-store';

export type TaskProjectRevealTarget = {
  projectId: string;
  taskId: string;
};

export function taskProjectRevealTarget(
  event: NavigationEvent
): TaskProjectRevealTarget | undefined {
  if (
    event.kind !== 'traversal' ||
    (event.source !== 'direct' && event.source !== 'history') ||
    event.to.viewId !== taskViewDef.id
  ) {
    return undefined;
  }
  const { projectId, taskId } = event.to.params as {
    projectId?: string;
    taskId?: string;
  };
  return projectId && taskId ? { projectId, taskId } : undefined;
}

type NavigationEvents = {
  readonly onDidNavigate: Pick<Emitter<NavigationEvent>, 'subscribe'>;
};

type ProjectRevealer = {
  revealProject(projectId: string): void;
};

export class SidebarNavigationController {
  private unsubscribe: Unsubscribe | undefined;

  constructor(
    private readonly navigation: NavigationEvents,
    private readonly sidebar: ProjectRevealer,
    private readonly isTaskPinned: (projectId: string, taskId: string) => boolean
  ) {}

  activate(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.navigation.onDidNavigate.subscribe((event) => {
      const target = taskProjectRevealTarget(event);
      if (!target || this.isTaskPinned(target.projectId, target.taskId)) return;
      this.sidebar.revealProject(target.projectId);
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}
