import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { projectSettingsChangedChannel } from '@shared/events/projectEvents';
import { ptyExitChannel } from '@shared/events/ptyEvents';
import { createLifecycleScriptTerminalId } from '@shared/terminals';
import { LifecycleScriptsStore, LifecycleScriptStore } from './lifecycle-scripts';

const eventHandlers = new Map<string, (data: unknown) => void>();
const offPtyExit = vi.fn();
const getSettings = vi.hoisted(() => vi.fn());
const watchSetPaths = vi.hoisted(() => vi.fn(async () => ({ success: true, data: {} })));
const watchStop = vi.hoisted(() => vi.fn(async () => ({ success: true, data: {} })));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((event: { name: string }, cb: (data: unknown) => void, topic?: string) => {
      eventHandlers.set(`${event.name}.${topic ?? ''}`, cb);
      return offPtyExit;
    }),
  },
  rpc: {
    projectSettings: {
      getSettings,
    },
    fs: {
      watchSetPaths,
      watchStop,
    },
  },
}));

vi.mock('@renderer/lib/pty/pty-session', () => ({
  PtySession: class {
    pty = null;
    status = 'disconnected';

    constructor(readonly sessionId: string) {}

    connect = vi.fn(async () => {});
    dispose = vi.fn();
  },
}));

describe('LifecycleScriptStore', () => {
  beforeEach(() => {
    eventHandlers.clear();
    offPtyExit.mockClear();
    getSettings.mockReset();
    watchSetPaths.mockClear();
    watchStop.mockClear();
  });

  it('tracks a running script until its PTY exits', () => {
    const store = new LifecycleScriptStore(
      { id: 'script-id', type: 'run', label: 'Run', command: 'pnpm dev' },
      'project-1',
      'branch:feature'
    );

    expect(store.isRunning).toBe(false);

    store.markRunning();

    expect(store.isRunning).toBe(true);

    eventHandlers.get(`${ptyExitChannel.name}.${store.session.sessionId}`)?.({ exitCode: 0 });

    expect(store.isRunning).toBe(false);
  });

  it('unsubscribes from PTY exit events on dispose', () => {
    const store = new LifecycleScriptStore(
      { id: 'script-id', type: 'run', label: 'Run', command: 'pnpm dev' },
      'project-1',
      'branch:feature'
    );

    store.dispose();

    expect(offPtyExit).toHaveBeenCalledTimes(1);
  });
});

describe('LifecycleScriptsStore', () => {
  beforeEach(() => {
    eventHandlers.clear();
    offPtyExit.mockClear();
    getSettings.mockReset();
    watchSetPaths.mockClear();
    watchStop.mockClear();
  });

  it('uses stable script IDs and reconciles command changes from .emdash.json watch events', async () => {
    getSettings
      .mockResolvedValueOnce({ scripts: { run: 'pnpm dev' } })
      .mockResolvedValueOnce({ scripts: { run: 'pnpm start' } });
    const store = new LifecycleScriptsStore('project-1', 'workspace-1');

    await (store as unknown as { load(): Promise<void> }).load();

    expect(watchSetPaths).toHaveBeenCalledWith(
      'project-1',
      'workspace-1',
      [''],
      'lifecycle-scripts'
    );
    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0].data.id).toBe(createLifecycleScriptTerminalId('run'));
    expect(store.tabs[0].data.command).toBe('pnpm dev');

    eventHandlers.get(`${fsWatchEventChannel.name}.`)?.({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      events: [{ type: 'modify', entryType: 'file', path: '.emdash.json' }],
    });

    await expect.poll(() => store.tabs[0]?.data.command).toBe('pnpm start');
    expect(store.tabs[0].data.id).toBe(createLifecycleScriptTerminalId('run'));

    store.dispose();
    expect(watchStop).toHaveBeenCalledWith('project-1', 'workspace-1', 'lifecycle-scripts');
  });

  it('reloads lifecycle scripts when project settings change', async () => {
    getSettings
      .mockResolvedValueOnce({ scripts: { setup: 'pnpm install' } })
      .mockResolvedValueOnce({ scripts: { setup: 'corepack install', run: 'pnpm dev' } });
    const store = new LifecycleScriptsStore('project-1', 'workspace-1');

    await (store as unknown as { load(): Promise<void> }).load();

    eventHandlers.get(`${projectSettingsChangedChannel.name}.`)?.({ projectId: 'project-1' });

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
    resolveSettings({ scripts: { run: 'pnpm dev' } });
    await loadPromise;

    expect(store.tabs).toEqual([]);
    expect(watchStop).toHaveBeenCalledWith('project-1', 'workspace-1', 'lifecycle-scripts');
  });
});
