import { describe, expect, it, vi } from 'vitest';
import type { LocalProject } from '@shared/projects';
import { SidebarStore } from './sidebar-store';

type TestProject = { id: string; createdAt: string; mountedProject: null };
type TestProjectManager = { projects: Map<string, TestProject> };
type SidebarProjectManager = ConstructorParameters<typeof SidebarStore>[0];

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(),
  },
  rpc: {},
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {},
}));

function localProject(overrides: Partial<LocalProject>): LocalProject {
  return {
    type: 'local',
    id: 'project-id',
    name: 'Project',
    path: '/project',
    baseRef: 'main',
    repositoryWorkspaceId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function projectManager(projects: LocalProject[]): SidebarProjectManager {
  const manager: TestProjectManager = {
    projects: new Map(
      projects.map((project) => [
        project.id,
        { id: project.id, createdAt: project.createdAt, mountedProject: null },
      ])
    ),
  };
  return manager as unknown as SidebarProjectManager;
}

describe('SidebarStore project ordering', () => {
  it('sorts projects newest first by default', () => {
    const store = new SidebarStore(
      projectManager([
        localProject({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
        localProject({ id: 'new', createdAt: '2026-01-02T00:00:00.000Z' }),
      ])
    );

    expect(store.orderedProjects.map((project) => project.id)).toEqual(['new', 'old']);
  });

  it('places projects missing from a saved manual order first', () => {
    const store = new SidebarStore(
      projectManager([
        localProject({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
        localProject({ id: 'manual', createdAt: '2026-01-02T00:00:00.000Z' }),
        localProject({ id: 'new', createdAt: '2026-01-03T00:00:00.000Z' }),
      ])
    );

    store.setProjectOrder(['manual', 'old']);

    expect(store.orderedProjects.map((project) => project.id)).toEqual(['new', 'manual', 'old']);
  });
});
