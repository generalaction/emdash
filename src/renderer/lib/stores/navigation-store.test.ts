import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/lib/modal/modal-store', () => ({
  modalStore: { closeModal: vi.fn() },
}));

vi.mock('@renderer/utils/focus-tracker', () => ({
  focusTracker: { transition: vi.fn(() => null) },
}));

vi.mock('@renderer/utils/telemetryClient', () => ({
  captureTelemetry: vi.fn(),
}));

vi.mock('./app-state', () => ({
  appState: {
    history: { push: vi.fn() },
  },
}));

const { NavigationStore } = await import('./navigation-store');

function buildStore() {
  const store = new NavigationStore();
  store.registerView('home');
  store.registerView('project');
  store.registerView('settings');
  store.registerView('library');
  store.registerView('skills');
  store.registerView('mcp');
  return store;
}

describe('NavigationStore.restoreSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restores a snapshot whose view is registered', () => {
    const store = buildStore();
    store.restoreSnapshot({
      currentViewId: 'project',
      viewParams: { project: { projectId: 'p1' } },
    });
    expect(store.currentViewId).toBe('project');
    expect(store.viewParamsStore.project).toEqual({ projectId: 'p1' });
    expect(store.lastNonSettingsView).toBe('project');
    expect(store.lastNonLibraryView).toBe('project');
  });

  it('falls back to home when the persisted view is not in the registry', () => {
    const store = buildStore();
    store.restoreSnapshot({
      currentViewId: 'phantom-view-from-old-build',
      viewParams: { project: { projectId: 'p1' } },
    });
    expect(store.currentViewId).toBe('home');
    expect(store.lastNonSettingsView).toBe('home');
  });

  it('strips viewParams entries whose key is not a registered view', () => {
    const store = buildStore();
    store.restoreSnapshot({
      currentViewId: 'home',
      viewParams: {
        project: { projectId: 'p1' },
        ghostView: { stale: true },
      },
    });
    expect(store.viewParamsStore.project).toEqual({ projectId: 'p1' });
    expect((store.viewParamsStore as Record<string, unknown>).ghostView).toBeUndefined();
  });

  it('does not touch lastNonSettingsView when the persisted view is settings', () => {
    const store = buildStore();
    store.restoreSnapshot({ currentViewId: 'settings' });
    expect(store.currentViewId).toBe('settings');
    expect(store.lastNonSettingsView).toBe('home');
  });

  it('honors a guard redirect after a valid view is restored', () => {
    const store = buildStore();
    store.registerGuard('project', () => ({ ok: false, redirect: 'home' }));
    store.restoreSnapshot({
      currentViewId: 'project',
      viewParams: { project: { projectId: 'gone' } },
    });
    expect(store.currentViewId).toBe('home');
  });

  it('tracks the last non-library view across library subviews', () => {
    const store = buildStore();
    store.navigate('project', { projectId: 'p1' });
    store.navigate('library');
    store.navigate('skills');
    store.navigate('mcp');
    expect(store.currentViewId).toBe('mcp');
    expect(store.lastNonLibraryView).toBe('project');
  });
});
