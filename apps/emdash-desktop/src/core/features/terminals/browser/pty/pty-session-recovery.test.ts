import { deferred } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import type { FrontendPtyConnector } from '../../api/browser/pty/pty';
import { PtySession } from '../../api/browser/pty/pty-session';

vi.mock('../../api/browser/pty/pty', () => ({
  FrontendPty: class {
    constructor(
      _id: string,
      _theme: unknown,
      _file: unknown,
      _external: unknown,
      readonly connector: FrontendPtyConnector
    ) {}
    connect = vi.fn(async () => {});
    sendInput(data: string) {
      this.connector.sendInput?.(data);
    }
    dispose() {}
  },
}));

describe('retained terminal attachment recovery', () => {
  it('retries failed reconciliation without replacing the displayed terminal', async () => {
    const prepare = vi.fn(async () => {});
    const session = new PtySession('terminal', prepare);
    await session.connect();
    const display = session.pty;
    prepare.mockRejectedValueOnce(new Error('Temporary attachment failure'));
    await expect(session.refreshAttachment()).rejects.toThrow('Temporary attachment failure');
    expect(session.status).toBe('disconnected');
    await session.connect();
    expect(session.status).toBe('ready');
    expect(session.pty).toBe(display);
    expect(prepare).toHaveBeenCalledTimes(3);
    session.dispose();
  });

  it('runs a newer reconciliation after an in-flight attachment finishes', async () => {
    const prepare = vi.fn(async () => {});
    const session = new PtySession('terminal', prepare);
    await session.connect();
    const gate = deferred<void>();
    prepare.mockReturnValueOnce(gate.promise);
    const old = session.refreshAttachment();
    await Promise.resolve();
    const current = session.refreshAttachment();
    gate.resolve();
    await Promise.all([old, current]);
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(session.status).toBe('ready');
    session.dispose();
  });

  it('recovers a newer request even when the superseded preparation fails', async () => {
    const prepare = vi.fn(async () => {});
    const session = new PtySession('terminal', prepare);
    await session.connect();
    const gate = deferred<void>();
    prepare.mockReturnValueOnce(gate.promise);
    const old = session.refreshAttachment();
    await Promise.resolve();
    const current = session.refreshAttachment();
    gate.reject(new Error('Superseded backend disconnected'));
    await Promise.all([old, current]);
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(session.status).toBe('ready');
    session.dispose();
  });

  it('settles unsuccessful preparation as disconnected and permits a later retry', async () => {
    const prepare = vi.fn<() => Promise<void | false>>(async () => {});
    const session = new PtySession('terminal', prepare);
    await session.connect();
    const display = session.pty;
    prepare.mockResolvedValueOnce(false);
    await session.refreshAttachment();
    expect(session.status).toBe('disconnected');
    await session.connect();
    expect(session.status).toBe('ready');
    expect(session.pty).toBe(display);
    session.dispose();
  });

  it('drops offline input, rehydrates the backend, and retains the displayed terminal', async () => {
    let usable = true;
    const prepare = vi.fn(async () => {});
    const sendInput = vi.fn();
    const session = new PtySession(
      'terminal',
      prepare,
      undefined,
      undefined,
      { connect: () => () => {}, sendInput },
      () => usable
    );
    await session.connect();
    const display = session.pty;
    display?.sendInput('before');
    usable = false;
    display?.sendInput('must-not-replay');
    usable = true;
    await session.refreshAttachment();
    expect(session.pty).toBe(display);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(sendInput.mock.calls).toEqual([['before']]);
    display?.sendInput('after');
    expect(sendInput.mock.calls).toEqual([['before'], ['after']]);
    session.dispose();
  });
});
