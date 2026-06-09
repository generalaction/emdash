import { describe, expect, it, vi } from 'vitest';
import { SidebarStore } from './sidebar-store';

type TestProject = { id: string; createdAt: string; mountedProject: null };
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

function projectManager(projects: { id: string; createdAt: string }[]): SidebarProjectManager {
  return {
    projects: new Map(projects.map((p) => [p.id, { ...p, mountedProject: null }])),
  } as unknown as SidebarProjectManager;
}

describe('SidebarStore project ordering', () => {
  it('sorts projects newest first by default', () => {
    const store = new SidebarStore(
      projectManager([
        { id: 'old', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'new', createdAt: '2026-01-02T00:00:00.000Z' },
      ])
    );

    expect(store.orderedProjects.map((project) => project.id)).toEqual(['new', 'old']);
  });

  it('places projects missing from a saved manual order first', () => {
    const store = new SidebarStore(
      projectManager([
        { id: 'old', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'manual', createdAt: '2026-01-02T00:00:00.000Z' },
        { id: 'new', createdAt: '2026-01-03T00:00:00.000Z' },
      ])
    );

    store.setProjectOrder(['manual', 'old']);

    expect(store.orderedProjects.map((project) => project.id)).toEqual(['new', 'manual', 'old']);
  });
});
