import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectStore } from '@core/features/projects/api/browser/stores/project';
import type { TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import { taskViewKind } from '@core/features/tasks/api/browser/task-state/task-selectors';

const projectManager = {
  projects: new Map<string, ProjectStore>(),
};

vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  asAvailableProject: (store: ProjectStore | undefined) =>
    store?.context?.kind === 'available' ? store.context.context : undefined,
  asMounted: () => undefined,
  getProjectManagerStore: () => projectManager,
  getProjectStore: (projectId: string) => projectManager.projects.get(projectId),
}));

function projectWithContext(context: ProjectStore['context']): ProjectStore {
  return {
    state: 'unmounted',
    id: 'project-id',
    unmounted: { kind: 'failed', message: 'Host unavailable' },
    context,
  } as ProjectStore;
}

describe('taskViewKind Project context routing', () => {
  beforeEach(() => {
    projectManager.projects.clear();
  });

  it('waits while the desktop Project context hydrates', () => {
    projectManager.projects.set(
      'project-id',
      projectWithContext({
        kind: 'hydrating',
        project: { id: 'project-id' } as never,
      })
    );

    expect(taskViewKind(undefined, 'project-id')).toBe('project-hydrating');
  });

  it('reports only desktop context failure as a Project error', () => {
    projectManager.projects.set(
      'project-id',
      projectWithContext({
        kind: 'desktop-context-failed',
        project: { id: 'project-id' } as never,
        error: {
          type: 'context-initialization-failed',
          stage: 'memento',
          message: 'Memento hydration failed',
        },
      })
    );

    expect(taskViewKind(undefined, 'project-id')).toBe('project-error');
  });

  it('ignores Host mount failure after desktop context is available', () => {
    projectManager.projects.set(
      'project-id',
      projectWithContext({
        kind: 'available',
        context: { project: { id: 'project-id' } } as never,
      })
    );
    const task = { state: 'provisioned' } as TaskStore;

    expect(taskViewKind(task, 'project-id')).toBe('ready');
  });
});
