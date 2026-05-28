import { describe, expect, it, vi } from 'vitest';
import { PtySession } from './pty-session';

const frontendConnect = vi.hoisted(() => vi.fn());
const frontendDispose = vi.hoisted(() => vi.fn());

vi.mock('@renderer/lib/pty/pty', () => ({
  FrontendPty: class {
    constructor(readonly sessionId: string) {}

    connect = frontendConnect;
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

describe('PtySession', () => {
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
});
