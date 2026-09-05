import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFaultPeer } from '../../testing/connection-supervisor-fixture';
import { workspaceServerTargetKey } from '../targets';
import { createWorkspaceServerDialer } from './wire-connection-manager';

describe('bounded workspace-server dialer', () => {
  let peer: ReturnType<typeof createFaultPeer>;
  const target = { kind: 'ssh' as const, sshConnectionId: 'host', socketPath: '/test.sock' };
  beforeEach(() => {
    vi.useFakeTimers();
    peer = createFaultPeer();
  });
  afterEach(async () => {
    await peer.dispose();
    vi.useRealTimers();
  });

  it('keys targets by destination identity and socket', () => {
    expect(workspaceServerTargetKey(target)).not.toBe(
      workspaceServerTargetKey({ ...target, sshConnectionId: 'other' })
    );
    expect(workspaceServerTargetKey(target)).not.toBe(
      workspaceServerTargetKey({ ...target, socketPath: '/other.sock' })
    );
  });

  it('dials once, initializes, and closes without retaining a connection', async () => {
    const dialer = createWorkspaceServerDialer({ openTransport: () => peer.openTransport() });
    const result = await dialer.dialOnce(target);
    expect(result.server.daemonId).toBe('daemon-1');
    expect(peer.current.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(peer.opens).toBe(1);
  });

  it('closes a candidate returned after its bounded open deadline', async () => {
    const release = peer.stallOpen();
    const dialer = createWorkspaceServerDialer({ openTransport: () => peer.openTransport() });
    const pending = dialer.dialOnce(target);
    const rejected = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5_001);
    await rejected;
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.current.closed).toBe(true);
    expect(peer.opens).toBe(1);
  });

  it('cancels a stalled initialization and never schedules a retry', async () => {
    const release = peer.stallInitialize();
    const abort = new AbortController();
    const dialer = createWorkspaceServerDialer({ openTransport: () => peer.openTransport() });
    const pending = dialer.dialOnce(target, { signal: abort.signal });
    const rejected = expect(pending).rejects.toThrow('Cancelled');
    await vi.advanceTimersByTimeAsync(0);
    abort.abort(new Error('Cancelled'));
    await rejected;
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(peer.current.closed).toBe(true);
    expect(peer.opens).toBe(1);
  });
});
