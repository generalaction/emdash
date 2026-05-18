import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PtySession } from '@renderer/lib/pty/pty-session';

const harness = vi.hoisted(() => {
  const state: {
    resolvePrefetch: (() => void) | null;
    rejectPrefetch: ((error: unknown) => void) | null;
    constructed: string[];
    connected: string[];
    disposed: string[];
  } = {
    resolvePrefetch: null,
    rejectPrefetch: null,
    constructed: [],
    connected: [],
    disposed: [],
  };

  class FakeFrontendPty {
    constructor(readonly sessionId: string) {
      state.constructed.push(sessionId);
    }
    async connect(): Promise<void> {
      state.connected.push(this.sessionId);
    }
    dispose(): void {
      state.disposed.push(this.sessionId);
    }
  }

  return { state, FakeFrontendPty };
});

vi.mock('@renderer/lib/pty/pty', () => ({
  FrontendPty: harness.FakeFrontendPty,
  prefetchTerminalSettings: () =>
    new Promise<void>((resolve, reject) => {
      harness.state.resolvePrefetch = resolve;
      harness.state.rejectPrefetch = reject;
    }),
}));

beforeEach(() => {
  harness.state.resolvePrefetch = null;
  harness.state.rejectPrefetch = null;
  harness.state.constructed.length = 0;
  harness.state.connected.length = 0;
  harness.state.disposed.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PtySession lifecycle', () => {
  it('does not resurrect a session disposed while prefetch is pending', async () => {
    const session = new PtySession('test-session');
    const connectPromise = session.connect();
    expect(session.status).toBe('connecting');

    session.dispose();
    expect(session.status).toBe('disconnected');
    expect(session.pty).toBeNull();

    harness.state.resolvePrefetch?.();
    await connectPromise;

    expect(harness.state.constructed).toEqual([]);
    expect(harness.state.connected).toEqual([]);
    expect(session.status).toBe('disconnected');
    expect(session.pty).toBeNull();
  });

  it('ignores connect() called after dispose()', async () => {
    const session = new PtySession('test-session');
    session.dispose();

    await session.connect();

    expect(harness.state.constructed).toEqual([]);
    expect(session.status).toBe('disconnected');
  });

  it('still reaches ready when no disposal happens', async () => {
    const session = new PtySession('happy-path');
    const connectPromise = session.connect();
    harness.state.resolvePrefetch?.();
    await connectPromise;

    expect(harness.state.constructed).toEqual(['happy-path']);
    expect(harness.state.connected).toEqual(['happy-path']);
    expect(session.status).toBe('ready');
  });
});
