import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ptyExitChannel } from '@shared/events/ptyEvents';
import { LifecycleScriptStore } from './lifecycle-scripts';

const eventHandlers = new Map<string, (data: unknown) => void>();
const offPtyExit = vi.fn();

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((event: { name: string }, cb: (data: unknown) => void, topic?: string) => {
      eventHandlers.set(`${event.name}.${topic ?? ''}`, cb);
      return offPtyExit;
    }),
  },
  rpc: {},
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
