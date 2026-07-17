import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchNavigationState } from '@core/features/workbench/contributions/mementos';
import type { MementoHandle } from '@core/primitives/mementos/browser';

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
const { appState } = await import('./app-state');

function buildStore() {
  const store = new NavigationStore();
  store.registerView('home');
  store.registerView('project');
  store.registerView('task');
  store.registerView('settings');
  store.registerView('library');
  store.registerView('skills');
  store.registerView('mcp');
  return store;
}

function handle(
  value: Omit<WorkbenchNavigationState, 'version'> & { version?: '1' }
): MementoHandle<WorkbenchNavigationState> {
  let current: WorkbenchNavigationState = { version: '1', ...value };
  return {
    get value() {
      return current;
    },
    ready: Promise.resolve(),
    isPending: false,
    hasStoredValue: true,
    read: () => current,
    update: (next) => {
      current = typeof next === 'function' ? next(current) : next;
    },
    reset: async () => {},
    flush: async () => {},
    autoPersist: () =>
      (() => {}) as ReturnType<MementoHandle<WorkbenchNavigationState>['autoPersist']>,
    dispose: async () => {},
  };
}

describe('NavigationStore memento attachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restores a snapshot whose view is registered', () => {
    const store = buildStore();
    store.attachMemento(
      handle({
        currentViewId: 'project',
        viewParams: { project: { projectId: 'p1' } },
      })
    );
    expect(store.currentViewId).toBe('project');
    expect(store.viewParamsStore.project).toEqual({ projectId: 'p1' });
    expect(store.lastNonSettingsView).toBe('project');
    expect(store.lastNonLibraryView).toBe('project');
  });

  it('falls back to home when the persisted view is not in the registry', () => {
    const store = buildStore();
    store.attachMemento(
      handle({
        currentViewId: 'phantom-view-from-old-build',
        viewParams: { project: { projectId: 'p1' } },
      })
    );
    expect(store.currentViewId).toBe('home');
    expect(store.lastNonSettingsView).toBe('home');
  });

  it('strips viewParams entries whose key is not a registered view', () => {
    const store = buildStore();
    store.attachMemento(
      handle({
        currentViewId: 'home',
        viewParams: {
          project: { projectId: 'p1' },
          ghostView: { stale: true },
        },
      })
    );
    expect(store.viewParamsStore.project).toEqual({ projectId: 'p1' });
    expect((store.viewParamsStore as Record<string, unknown>).ghostView).toBeUndefined();
  });

  it('does not touch lastNonSettingsView when the persisted view is settings', () => {
    const store = buildStore();
    store.attachMemento(handle({ currentViewId: 'settings', viewParams: {} }));
    expect(store.currentViewId).toBe('settings');
    expect(store.lastNonSettingsView).toBe('home');
  });

  it('honors a guard redirect after a valid view is restored', () => {
    const store = buildStore();
    store.registerGuard('project', () => ({ ok: false, redirect: 'home' }));
    store.attachMemento(
      handle({
        currentViewId: 'project',
        viewParams: { project: { projectId: 'gone' } },
      })
    );
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

  it('reuses stored params when navigating without params', () => {
    const store = buildStore();
    store.attachMemento(
      handle({
        currentViewId: 'home',
        viewParams: { project: { projectId: 'p1' } },
      })
    );

    store.navigate('project');

    expect(store.currentViewId).toBe('project');
    expect(store.viewParamsStore.project).toEqual({ projectId: 'p1' });
    expect(appState.history.push).toHaveBeenCalledWith({
      kind: 'view',
      viewId: 'project',
      params: { projectId: 'p1' },
    });
  });

  it('overwrites stored params when navigating with params', () => {
    const store = buildStore();
    store.attachMemento(
      handle({
        currentViewId: 'home',
        viewParams: { project: { projectId: 'p1' } },
      })
    );

    store.navigate('project', { projectId: 'p2' });

    expect(store.viewParamsStore.project).toEqual({ projectId: 'p2' });
    expect(appState.history.push).toHaveBeenCalledWith({
      kind: 'view',
      viewId: 'project',
      params: { projectId: 'p2' },
    });
  });

  it('does not push task navigation into view history', () => {
    const store = buildStore();

    store.navigate('task', { projectId: 'p1', taskId: 't1' });

    expect(store.currentViewId).toBe('task');
    expect(appState.history.push).not.toHaveBeenCalled();
  });

  it('merges object view-param updates and supports functional updates', () => {
    const store = buildStore();
    store.attachMemento(
      handle({
        currentViewId: 'settings',
        viewParams: { settings: { tab: 'general' } },
      })
    );

    store.updateViewParams('settings', { tab: 'browser' });
    expect(store.viewParamsStore.settings).toEqual({ tab: 'browser' });

    store.updateViewParams('settings', (current) => ({
      ...current,
      tab: 'interface' as const,
    }));
    expect(store.viewParamsStore.settings).toEqual({ tab: 'interface' });
  });

  it('applies redirect params returned by a guard', () => {
    const store = buildStore();
    store.registerGuard('project', () => ({
      ok: false,
      redirect: 'task',
      params: { projectId: 'p1', taskId: 't1' },
    }));

    store.navigate('project', { projectId: 'p1' });

    expect(store.currentViewId).toBe('task');
    expect(store.viewParamsStore.task).toEqual({ projectId: 'p1', taskId: 't1' });
  });

  it('revalidates the current view and applies a guard redirect', () => {
    const store = buildStore();
    store.navigate('project', { projectId: 'p1' });
    store.registerGuard('project', () => ({ ok: false, redirect: 'home' }));

    store.revalidate();

    expect(store.currentViewId).toBe('home');
  });
});
