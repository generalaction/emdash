import { beforeEach, describe, expect, it, vi } from 'vitest';
import { events } from '@renderer/lib/ipc';
import { ptyStartedChannel } from '@shared/events/appEvents';
import { PtySession } from './pty-session';

const frontendConnect = vi.hoisted(() => vi.fn());
const frontendClear = vi.hoisted(() => vi.fn());
const frontendDispose = vi.hoisted(() => vi.fn());
const frontendInstances = vi.hoisted(() => [] as Array<{ sessionId: string }>);
const frontendConnectedSessionIds = vi.hoisted(() => [] as string[]);

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(),
  },
}));

vi.mock('@renderer/lib/pty/pty', () => ({
  FrontendPty: class {
    constructor(readonly sessionId: string) {
      frontendInstances.push(this);
    }

    connect = () => {
      frontendConnectedSessionIds.push(this.sessionId);
      return frontendConnect();
    };
    clear = frontendClear;
    dispose = frontendDispose;
  },
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function ptyStartedListeners() {
  return vi
    .mocked(events.on)
    .mock.calls.filter(([channel]) => channel === ptyStartedChannel)
    .map(([, listener]) => listener as (event: { id: string }) => void);
}

describe('PtySession', () => {
  beforeEach(() => {
    frontendConnect.mockReset();
    frontendClear.mockReset();
    frontendDispose.mockReset();
    frontendInstances.length = 0;
    frontendConnectedSessionIds.length = 0;
    vi.mocked(events.on).mockReset();
    vi.mocked(events.on).mockReturnValue(() => {});
  });

  it('does not mark the session ready when disposed while connect is in flight', async () => {
    const connect = deferred<void>();
    frontendConnect.mockReturnValue(connect.promise);

    const session = new PtySession('session-1');
    const connectPromise = session.connect();
    await Promise.resolve();

    expect(session.status).toBe('connecting');
    expect(session.pty).not.toBeNull();

    session.dispose();

    expect(session.status).toBe('disconnected');
    expect(session.pty).toBeNull();

    connect.resolve();
    await connectPromise;

    expect(session.status).toBe('disconnected');
    expect(session.pty).toBeNull();
    expect(frontendDispose).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes from backend start events only when destroyed', () => {
    const offPtyStarted = vi.fn();
    vi.mocked(events.on).mockReturnValue(offPtyStarted);
    const session = new PtySession('session-1');

    session.dispose();
    expect(offPtyStarted).not.toHaveBeenCalled();

    session.destroy();
    expect(offPtyStarted).toHaveBeenCalledTimes(1);
  });

  it('keeps the frontend PTY when the backend starts again for the session', async () => {
    frontendConnect.mockResolvedValue(undefined);
    const session = new PtySession('session-1');

    await session.connect();
    const initialPty = session.pty;
    expect(initialPty).not.toBeNull();

    for (const listener of ptyStartedListeners()) {
      listener({ id: 'session-1' });
    }
    await Promise.resolve();

    expect(frontendDispose).not.toHaveBeenCalled();
    expect(frontendInstances).toHaveLength(1);
    expect(frontendConnect).toHaveBeenCalledTimes(1);
    expect(frontendConnectedSessionIds).toEqual(['session-1']);
    expect(session.pty).toBe(initialPty);
    expect(session.status).toBe('ready');
  });

  it('clears the frontend PTY when backend replacement is configured to preserve the instance', async () => {
    frontendConnect.mockResolvedValue(undefined);
    const session = new PtySession('session-1', undefined, undefined, undefined, {
      clearOnBackendStart: true,
    });

    await session.connect();
    const initialPty = session.pty;
    expect(initialPty).not.toBeNull();

    for (const listener of ptyStartedListeners()) {
      listener({ id: 'session-1' });
    }
    await Promise.resolve();

    expect(frontendClear).toHaveBeenCalledTimes(1);
    expect(frontendDispose).not.toHaveBeenCalled();
    expect(frontendInstances).toHaveLength(1);
    expect(session.pty).toBe(initialPty);
    expect(session.status).toBe('ready');
  });

  it('does not recreate for the first backend start that arrives during initial connect', async () => {
    const connect = deferred<void>();
    frontendConnect.mockReturnValue(connect.promise);

    const session = new PtySession('session-1');
    const connectPromise = session.connect();
    await Promise.resolve();
    const initialPty = session.pty;

    for (const listener of ptyStartedListeners()) {
      listener({ id: 'session-1' });
    }
    await Promise.resolve();

    expect(frontendDispose).not.toHaveBeenCalled();
    expect(frontendInstances).toHaveLength(1);
    expect(session.pty).toBe(initialPty);

    connect.resolve();
    await connectPromise;
    expect(session.status).toBe('ready');
  });

  it('does not recreate when multiple backend starts arrive during initial connect', async () => {
    const firstConnect = deferred<void>();
    frontendConnect.mockReturnValueOnce(firstConnect.promise);

    const session = new PtySession('session-1');
    const firstConnectPromise = session.connect();
    await Promise.resolve();
    const initialPty = session.pty;
    expect(initialPty).not.toBeNull();
    expect(session.status).toBe('connecting');

    for (const listener of ptyStartedListeners()) listener({ id: 'session-1' });
    for (const listener of ptyStartedListeners()) listener({ id: 'session-1' });
    await Promise.resolve();

    expect(frontendDispose).not.toHaveBeenCalled();
    expect(frontendInstances).toHaveLength(1);
    expect(session.pty).toBe(initialPty);

    firstConnect.resolve();
    await firstConnectPromise;
    expect(session.pty).toBe(initialPty);
    expect(session.status).toBe('ready');
  });
});
