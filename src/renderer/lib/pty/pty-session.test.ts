import { beforeEach, describe, expect, it, vi } from 'vitest';
import { events } from '@renderer/lib/ipc';
import { ptyStartedChannel } from '@shared/events/appEvents';
import { PtySession } from './pty-session';

const frontendConnect = vi.hoisted(() => vi.fn());
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
    .map(([, listener]) => listener as (event: { id: string; epoch: number }) => void);
}

describe('PtySession', () => {
  beforeEach(() => {
    frontendConnect.mockReset();
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

  it('recreates the frontend PTY when the backend starts a newer epoch for the session', async () => {
    frontendConnect.mockResolvedValue(undefined);
    const session = new PtySession('session-1');

    await session.connect();
    const initialPty = session.pty;
    expect(initialPty).not.toBeNull();

    for (const listener of ptyStartedListeners()) {
      listener({ id: 'session-1', epoch: 2 });
    }
    await Promise.resolve();

    expect(frontendDispose).toHaveBeenCalledTimes(1);
    expect(frontendInstances).toHaveLength(2);
    expect(session.pty).not.toBe(initialPty);
    expect(session.status).toBe('ready');
  });

  it('keeps the frontend PTY when backend replacement is configured to preserve scrollback', async () => {
    frontendConnect.mockResolvedValue(undefined);
    const session = new PtySession('session-1', undefined, undefined, undefined, {
      replaceFrontendOnBackendStart: false,
    });

    await session.connect();
    const initialPty = session.pty;
    expect(initialPty).not.toBeNull();

    for (const listener of ptyStartedListeners()) {
      listener({ id: 'session-1', epoch: 2 });
    }
    await Promise.resolve();

    expect(frontendDispose).not.toHaveBeenCalled();
    expect(frontendInstances).toHaveLength(1);
    expect(frontendConnect).toHaveBeenCalledTimes(1);
    expect(frontendConnectedSessionIds).toEqual(['session-1']);
    expect(session.pty).toBe(initialPty);
    expect(session.status).toBe('ready');
  });

  it('does not recreate for the first backend epoch that arrives during initial connect', async () => {
    const connect = deferred<void>();
    frontendConnect.mockReturnValue(connect.promise);

    const session = new PtySession('session-1');
    const connectPromise = session.connect();
    await Promise.resolve();
    const initialPty = session.pty;

    for (const listener of ptyStartedListeners()) {
      listener({ id: 'session-1', epoch: 42 });
    }
    await Promise.resolve();

    expect(frontendDispose).not.toHaveBeenCalled();
    expect(frontendInstances).toHaveLength(1);
    expect(session.pty).toBe(initialPty);

    connect.resolve();
    await connectPromise;
    expect(session.status).toBe('ready');
  });

  it('lets backend replacement win over an in-flight connect for an older frontend PTY', async () => {
    const firstConnect = deferred<void>();
    const secondConnect = deferred<void>();
    frontendConnect
      .mockReturnValueOnce(firstConnect.promise)
      .mockReturnValueOnce(secondConnect.promise);

    const session = new PtySession('session-1');
    const firstConnectPromise = session.connect();
    await Promise.resolve();
    const initialPty = session.pty;
    expect(initialPty).not.toBeNull();
    expect(session.status).toBe('connecting');

    for (const listener of ptyStartedListeners()) listener({ id: 'session-1', epoch: 42 });
    for (const listener of ptyStartedListeners()) listener({ id: 'session-1', epoch: 43 });
    await Promise.resolve();
    const replacementPty = session.pty;
    expect(replacementPty).not.toBe(initialPty);
    expect(frontendDispose).toHaveBeenCalledTimes(1);

    firstConnect.resolve();
    await firstConnectPromise;
    expect(session.pty).toBe(replacementPty);
    expect(session.status).toBe('connecting');

    secondConnect.resolve();
    await Promise.resolve();
    expect(session.pty).toBe(replacementPty);
    expect(session.status).toBe('ready');
  });
});
