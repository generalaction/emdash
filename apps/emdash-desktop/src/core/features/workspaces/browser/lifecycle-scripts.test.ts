import { ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LifecycleScriptsStore,
  LifecycleScriptStore,
} from '@core/features/workspaces/api/browser/lifecycle-scripts';
import { createLifecycleScriptTerminalId } from '@core/primitives/terminals/api';

const offEvent = vi.fn();
const getSettings = vi.hoisted(() => vi.fn());
const projectEvents = vi.hoisted(() => ({
  handler: null as null | ((event: { type: 'settings-changed'; projectId: string }) => void),
}));
const fileWatch = vi.hoisted(() => ({
  handler: null as null | (() => void),
  unsubscribe: vi.fn(),
}));

vi.mock('@core/features/editor/api/browser/files', () => ({
  watchFileContent: vi.fn(async (_workspaceId: string, _path: string, handler: () => void) => {
    fileWatch.handler = handler;
    return fileWatch.unsubscribe;
  }),
}));

vi.mock('@core/features/terminals/api/browser/client', () => ({
  getTerminalsClient: vi.fn(() => new Promise(() => {})),
}));
vi.mock('@renderer/lib/runtime/desktop-wire-client', () => ({
  getDesktopWireClient: async () => ({
    projectSettings: {
      getSettings,
    },
    projects: {
      events: {
        subscribe: async (
          _key: undefined,
          observer: {
            onEvent: (event: { type: 'settings-changed'; projectId: string }) => void;
          }
        ) => {
          projectEvents.handler = observer.onEvent;
          return offEvent;
        },
      },
    },
  }),
}));

vi.mock('@core/features/terminals/api/browser/pty/pty-session', () => ({
  PtySession: class {
    pty = null;
    status = 'disconnected';

    constructor(readonly sessionId: string) {}

    connect = vi.fn(async () => {});
    dispose = vi.fn();
    destroy = vi.fn();
  },
}));

describe('LifecycleScriptStore', () => {
  beforeEach(() => {
    offEvent.mockClear();
    projectEvents.handler = null;
    getSettings.mockReset();
    fileWatch.handler = null;
    fileWatch.unsubscribe.mockClear();
  });

  it('tracks script running state from workflow status updates', () => {
    const store = new LifecycleScriptStore(
      { id: 'script-id', type: 'run', label: 'Run', command: 'pnpm dev' },
      'project-1',
      'workspace-1',
      undefined
    );

    expect(store.isRunning).toBe(false);

    store.setStatus('running');

    expect(store.isRunning).toBe(true);
    expect(store.status).toBe('running');

    store.setStatus('succeeded');

    expect(store.isRunning).toBe(false);
    expect(store.status).toBe('succeeded');
  });

  it('destroys the script PTY session on dispose', () => {
    const store = new LifecycleScriptStore(
      { id: 'script-id', type: 'run', label: 'Run', command: 'pnpm dev' },
      'project-1',
      'workspace-1',
      undefined
    );

    store.dispose();

    expect(store.session.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('LifecycleScriptsStore', () => {
  beforeEach(() => {
    offEvent.mockClear();
    projectEvents.handler = null;
    getSettings.mockReset();
    fileWatch.handler = null;
    fileWatch.unsubscribe.mockClear();
  });

  it('uses stable script IDs and reconciles command changes from .emdash.json watch events', async () => {
    getSettings
      .mockResolvedValueOnce(ok({ scripts: { run: 'pnpm dev' } }))
      .mockResolvedValueOnce(ok({ scripts: { run: 'pnpm start' } }));
    const store = new LifecycleScriptsStore('project-1', 'workspace-1', '/workspace');

    await (store as unknown as { load(): Promise<void> }).load();

    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0].data.id).toBe(createLifecycleScriptTerminalId('run'));
    expect(store.tabs[0].data.command).toBe('pnpm dev');

    fileWatch.handler?.();

    await expect.poll(() => store.tabs[0]?.data.command).toBe('pnpm start');
    expect(store.tabs[0].data.id).toBe(createLifecycleScriptTerminalId('run'));

    store.dispose();
  });

  it('reloads lifecycle scripts when project settings change', async () => {
    getSettings
      .mockResolvedValueOnce(ok({ scripts: { setup: 'pnpm install' } }))
      .mockResolvedValueOnce(ok({ scripts: { setup: 'corepack install', run: 'pnpm dev' } }));
    const store = new LifecycleScriptsStore('project-1', 'workspace-1');

    await (store as unknown as { load(): Promise<void> }).load();

    await vi.waitFor(() => expect(projectEvents.handler).not.toBeNull());
    projectEvents.handler?.({ type: 'settings-changed', projectId: 'project-1' });

    await expect
      .poll(() => store.tabs.map((tab) => tab.data.command))
      .toEqual(['corepack install', 'pnpm dev']);
  });

  it('does not recreate script sessions when an in-flight load completes after dispose', async () => {
    let resolveSettings: (settings: unknown) => void = () => {};
    getSettings.mockReturnValue(
      new Promise((resolve) => {
        resolveSettings = resolve;
      })
    );
    const store = new LifecycleScriptsStore('project-1', 'workspace-1');

    const loadPromise = (store as unknown as { load(): Promise<void> }).load();
    store.dispose();
    resolveSettings(ok({ scripts: { run: 'pnpm dev' } }));
    await loadPromise;

    expect(store.tabs).toEqual([]);
  });

  it('keeps lifecycle script tabs empty when settings fail to load', async () => {
    getSettings.mockResolvedValue({
      success: false,
      error: { type: 'fs_error', message: 'filesystem unavailable' },
    });
    const store = new LifecycleScriptsStore('project-1', 'workspace-1');

    await (store as unknown as { load(): Promise<void> }).load();

    expect(store.tabs).toEqual([]);
  });
});
