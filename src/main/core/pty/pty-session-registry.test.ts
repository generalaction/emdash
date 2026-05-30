import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ptyStartedChannel } from '@shared/events/appEvents';
import { ptyDataChannel } from '@shared/events/ptyEvents';
import type { Pty, PtyExitInfo } from './pty';
import { PtySessionRegistry } from './pty-session-registry';

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
    on: vi.fn(() => () => {}),
  },
}));

const { events } = await import('@main/lib/events');

function fakePty(): Pty & {
  emitData(data: string): void;
  emitExit(info: PtyExitInfo): void;
} {
  const dataHandlers: Array<(data: string) => void> = [];
  const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn((handler) => dataHandlers.push(handler)),
    onExit: vi.fn((handler) => exitHandlers.push(handler)),
    emitData(data: string) {
      for (const handler of dataHandlers) handler(data);
    },
    emitExit(info: PtyExitInfo) {
      for (const handler of exitHandlers) handler(info);
    },
  };
}

describe('PtySessionRegistry', () => {
  beforeEach(() => {
    vi.mocked(events.emit).mockClear();
    vi.mocked(events.on).mockClear();
  });

  it('ignores stale data and exit cleanup from a replaced PTY', () => {
    const registry = new PtySessionRegistry();
    const first = fakePty();
    const second = fakePty();

    registry.register('session-1', first);
    registry.register('session-1', second);

    first.emitData('old output');
    first.emitExit({ exitCode: 0 });

    expect(registry.get('session-1')).toBe(second);
    expect(events.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'pty:data' }),
      'old output',
      'session-1'
    );

    second.emitExit({ exitCode: 0 });

    expect(registry.get('session-1')).toBeUndefined();
  });

  it('does not flush buffered output from an old PTY after replacement', async () => {
    vi.useFakeTimers();
    try {
      const registry = new PtySessionRegistry();
      const first = fakePty();
      const second = fakePty();

      registry.register('session-1', first);
      first.emitData('old buffered output');
      registry.register('session-1', second);
      vi.mocked(events.emit).mockClear();

      await vi.advanceTimersByTimeAsync(16);

      expect(events.emit).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: 'pty:data' }),
        'old buffered output',
        'session-1'
      );
      expect(registry.get('session-1')).toBe(second);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes buffered output when unregistering the current PTY before the flush timer fires', () => {
    const registry = new PtySessionRegistry();
    const pty = fakePty();

    registry.register('session-1', pty);
    pty.emitData('final output');
    registry.unregister('session-1');

    expect(events.emit).toHaveBeenCalledWith(ptyDataChannel, 'final output', 'session-1');
  });

  it('records resize dimensions before forwarding to the current PTY', () => {
    const registry = new PtySessionRegistry();
    const pty = fakePty();

    registry.register('session-1', pty);
    const resized = registry.resize('session-1', 120, 50);

    expect(resized).toBe(true);
    expect(pty.resize).toHaveBeenCalledWith(120, 50);
    expect(registry.getLastSize('session-1')).toEqual({ cols: 120, rows: 50 });
  });

  it('clears last observed size when preserving output after exit', () => {
    const registry = new PtySessionRegistry();
    const pty = fakePty();

    registry.register('session-1', pty, { preserveBufferOnExit: true });
    registry.resize('session-1', 120, 50);
    pty.emitExit({ exitCode: 0 });

    expect(registry.get('session-1')).toBeUndefined();
    expect(registry.getLastSize('session-1')).toBeUndefined();
  });

  it('emits a monotonically increasing epoch for every registered PTY', () => {
    const registry = new PtySessionRegistry();

    registry.register('session-1', fakePty());
    registry.register('session-1', fakePty());
    registry.register('session-2', fakePty());

    expect(events.emit).toHaveBeenCalledWith(ptyStartedChannel, { id: 'session-1', epoch: 1 });
    expect(events.emit).toHaveBeenCalledWith(ptyStartedChannel, { id: 'session-1', epoch: 2 });
    expect(events.emit).toHaveBeenCalledWith(ptyStartedChannel, { id: 'session-2', epoch: 3 });
  });
});
