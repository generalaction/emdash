import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fsWatchEventChannel } from '@shared/core/fs/fsEvents';
import { projectSettingsChangedChannel } from '@shared/core/projects/projectEvents';
import { lifecycleScriptStatusChannel } from '@shared/core/tasks/taskEvents';
import { createLifecycleScriptTerminalId } from '@shared/core/terminals/terminals';
import { LifecycleScriptsStore, LifecycleScriptStore } from './lifecycle-scripts';

const eventHandlers = new Map<string, (data: unknown) => void>();
const offEvent = vi.fn();
const getSettings = vi.hoisted(() => vi.fn());
const watchSetPaths = vi.hoisted(() => vi.fn(async () => ({ success: true, data: {} })));
const watchStop = vi.hoisted(() => vi.fn(async () => ({ success: true, data: {} })));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((event: { name: string }, cb: (data: unknown) => void, topic?: string) => {
      eventHandlers.set(`${event.name}.${topic ?? ''}`, cb);
      return offEvent;
    }),
  },
  rpc: {
    projectSettings: {
      getSettings,
    },
    workspace: {
      fs: {
        watchSetPaths,
        watchStop,
      },
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
    destroy = vi.fn();
  },
}));

describe('LifecycleScriptStore', () => {
  beforeEach(() => {
    eventHandlers.clear();
    offEvent.mockClear();
    getSettings.mockReset();
    watchSetPaths.mockClear();
    watchStop.mockClear();
  });

  it('tracks script running state from lifecycle status events', () => {
    const store = new LifecycleScriptStore(
      { id: 'script-id', type: 'run', label: 'Run', command: 'pnpm dev' },
      'project-1',
      'branch:feature'
    );

    expect(store.isRunning).toBe(false);

    eventHandlers.get(`${lifecycleScriptStatusChannel.name}.`)?.({
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'branch:feature',
      type: 'run',
      origin: 'manual',
      status: 'running',
    });

    expect(store.isRunning).toBe(true);
    expect(store.status).toBe('running');

    eventHandlers.get(`${lifecycleScriptStatusChannel.name}.`)?.({
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'branch:feature',
      type: 'run',
      origin: 'manual',
      status: 'succeeded',
      exitCode: 0,
    });

    expect(store.isRunning).toBe(false);
    expect(store.status).toBe('succeeded');
  });

  it('unsubscribes from lifecycle status events on dispose', () => {
    const store = new LifecycleScriptStore(
      { id: 'script-id', type: 'run', label: 'Run', command: 'pnpm dev' },
      'project-1',
      'branch:feature'
    );

    store.dispose();

    expect(offEvent).toHaveBeenCalledTimes(1);
  });
});

describe('LifecycleScriptsStore', () => {
  beforeEach(() => {
    eventHandlers.clear();
    offEvent.mockClear();
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
