import { describe, expect, it } from 'vitest';
import {
  createUnregisteredProject,
  createUnmountedProject,
  type ProjectStore,
} from '@core/features/projects/api/browser/stores/project';
import {
  projectViewKind,
  type ProjectViewKind,
} from '@core/features/projects/api/browser/stores/project-selectors';
import type { LocalProject } from '@core/primitives/projects/api';

const project: LocalProject = {
  type: 'local',
  id: 'project-id',
  name: 'Project',
  path: '/project',
  baseRef: 'main',
  repositoryWorkspaceId: null,
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
};

function registeredProject(context: ProjectStore['context']): ProjectStore {
  const store = createUnmountedProject(project, {
    kind: 'failed',
    message: 'Host unavailable',
  });
  store.context = context;
  return store;
}

describe('projectViewKind', () => {
  it.each<[string, ProjectStore | undefined, ProjectViewKind]>([
    ['missing Project', undefined, 'missing'],
    [
      'Project creation',
      createUnregisteredProject(
        'project-id',
        'Project',
        { kind: 'running', stage: 'registering' },
        'pick'
      ),
      'creating',
    ],
    ['context startup', registeredProject(null), 'hydrating'],
    ['context hydration', registeredProject({ kind: 'hydrating', project }), 'hydrating'],
    [
      'context failure',
      registeredProject({
        kind: 'desktop-context-failed',
        project,
        error: {
          type: 'context-initialization-failed',
          stage: 'memento',
          message: 'Memento hydration failed',
        },
      }),
      'context_error',
    ],
    [
      'available context despite Host mount failure',
      registeredProject({
        kind: 'available',
        context: { project } as NonNullable<
          Extract<ProjectStore['context'], { kind: 'available' }>
        >['context'],
      }),
      'ready',
    ],
  ])('reports %s as %s', (_label, store, expected) => {
    expect(projectViewKind(store)).toBe(expected);
  });
});
