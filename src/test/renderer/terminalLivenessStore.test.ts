import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Provide `window` in Node test environment
const win = globalThis as any;
if (typeof win.window === 'undefined') win.window = win;

// Controllable mock for window.electronAPI
let startedListener: ((data: { id: string; taskId: string | null }) => void) | null = null;
let exitedListener: ((data: { id: string; taskId: string | null }) => void) | null = null;
let ptyListResult: Array<{ id: string; taskId: string | null }> = [];

function simulateStarted(id: string, taskId: string | null) {
  startedListener?.({ id, taskId });
}

function simulateExited(id: string, taskId: string | null) {
  exitedListener?.({ id, taskId });
}

beforeEach(() => {
  startedListener = null;
  exitedListener = null;
  ptyListResult = [];

  win.electronAPI = {
    onPtyStarted: vi.fn((fn: any) => {
      startedListener = fn;
      return () => { startedListener = null; };
    }),
    onPtyExited: vi.fn((fn: any) => {
      exitedListener = fn;
      return () => { exitedListener = null; };
    }),
    ptyList: vi.fn(() => Promise.resolve(ptyListResult)),
  };
});

afterEach(() => {
  vi.resetModules();
  delete win.electronAPI;
});

async function getStore() {
  const mod = await import('../../renderer/lib/terminalLivenessStore');
  return mod.terminalLivenessStore;
}

describe('terminalLivenessStore', () => {
  it('emits false initially when no terminals exist', async () => {
    const store = await getStore();
    const fn = vi.fn();
    store.subscribe('task-1', fn);
    expect(fn).toHaveBeenCalledWith(false);
  });

  it('emits true when a main terminal starts', async () => {
    const store = await getStore();
    const fn = vi.fn();
    store.subscribe('task-1', fn);

    simulateStarted('claude-main-task-1', 'task-1');
    expect(fn).toHaveBeenLastCalledWith(true);
  });

  it('emits false when the terminal exits', async () => {
    const store = await getStore();
    const fn = vi.fn();
    store.subscribe('task-1', fn);

    simulateStarted('claude-main-task-1', 'task-1');
    expect(fn).toHaveBeenLastCalledWith(true);

    simulateExited('claude-main-task-1', 'task-1');
    expect(fn).toHaveBeenLastCalledWith(false);
  });

  it('stays true when one of multiple PTYs exits', async () => {
    const store = await getStore();
    const fn = vi.fn();
    store.subscribe('task-1', fn);

    simulateStarted('claude-main-task-1', 'task-1');
    simulateStarted('codex-main-task-1', 'task-1');
    expect(fn).toHaveBeenLastCalledWith(true);

    simulateExited('claude-main-task-1', 'task-1');
    // Still has codex terminal
    expect(fn).toHaveBeenLastCalledWith(true);

    simulateExited('codex-main-task-1', 'task-1');
    expect(fn).toHaveBeenLastCalledWith(false);
  });

  it('ignores chat terminals (taskId is null from getPtyTaskId)', async () => {
    const store = await getStore();
    const fn = vi.fn();
    store.subscribe('conv-1', fn);

    // In production, getPtyTaskId('claude-chat-conv-1') returns null
    simulateStarted('claude-chat-conv-1', null);
    // chat terminals should be ignored
    expect(fn).toHaveBeenCalledTimes(1); // only the initial false
    expect(fn).toHaveBeenLastCalledWith(false);
  });

  it('ignores events with null taskId', async () => {
    const store = await getStore();
    const fn = vi.fn();
    store.subscribe('task-1', fn);

    simulateStarted('claude-main-task-1', null);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith(false);
  });

  it('seeds from ptyList on first subscribe', async () => {
    ptyListResult = [
      { id: 'claude-main-task-1', taskId: 'task-1' },
      { id: 'codex-main-task-2', taskId: 'task-2' },
      { id: 'claude-chat-conv-1', taskId: null },
    ];

    const store = await getStore();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    store.subscribe('task-1', fn1);
    store.subscribe('task-2', fn2);

    // Wait for async seed
    await vi.waitFor(() => {
      expect(fn1).toHaveBeenLastCalledWith(true);
    });
    expect(fn2).toHaveBeenLastCalledWith(true);
  });

  it('filters early exits from seed results (race guard)', async () => {
    ptyListResult = [
      { id: 'claude-main-task-1', taskId: 'task-1' },
    ];

    const store = await getStore();
    const fn = vi.fn();
    store.subscribe('task-1', fn);

    // Exit arrives before seed resolves
    simulateExited('claude-main-task-1', 'task-1');

    // Wait for seed to complete
    await vi.waitFor(() => {
      expect((window as any).electronAPI.ptyList).toHaveBeenCalled();
    });

    // Should still be false — the exit arrived before seed, so seed filters it out
    // The exit event also called removePty but there was nothing to remove yet
    await new Promise((r) => setTimeout(r, 10));
    expect(fn).toHaveBeenLastCalledWith(false);
  });

  it('unsubscribe stops notifications', async () => {
    const store = await getStore();
    const fn = vi.fn();
    const unsub = store.subscribe('task-1', fn);
    fn.mockClear();

    unsub();
    simulateStarted('claude-main-task-1', 'task-1');
    expect(fn).not.toHaveBeenCalled();
  });
});
