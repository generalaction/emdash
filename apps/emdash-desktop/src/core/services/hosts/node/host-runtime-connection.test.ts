import { createScope, type Scope } from '@emdash/shared/concurrency';
import { systemClock } from '@emdash/shared/scheduling';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostRuntimeConnection } from './host-runtime-connection';
import { createFaultPeer } from './testing/connection-supervisor-fixture';

const target = { kind: 'ssh' as const, sshConnectionId: 'test', socketPath: '/workspace.sock' };

describe('HostRuntimeConnection', () => {
  let scope: Scope;
  let peer: ReturnType<typeof createFaultPeer>;
  let runtime: HostRuntimeConnection;
  let afterMessage: (() => void) | undefined;
  const onDisconnect = vi.fn();
  const onRequestTimeout = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    onDisconnect.mockClear();
    onRequestTimeout.mockClear();
    afterMessage = undefined;
    scope = createScope({ label: 'runtime-connection-test' });
    peer = createFaultPeer();
    runtime = new HostRuntimeConnection({
      scope,
      clock: systemClock,
      open: async () => {
        const transport = await peer.openTransport();
        return {
          ...transport,
          onMessage: (listener) =>
            transport.onMessage((message) => {
              listener(message);
              afterMessage?.();
            }),
        };
      },
      openTimeoutMs: 100,
      initializeTimeoutMs: 100,
      healthTimeoutMs: 50,
      onDisconnect,
      onRequestTimeout,
    });
  });

  afterEach(async () => {
    try {
      afterMessage = undefined;
      await scope.dispose();
      await peer.dispose();
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the logical connection and client while replacing the initialized transport', async () => {
    const connection = runtime.connection;
    const client = runtime.client;
    const attempt = scope.child('attempt');
    await runtime.establish(target, attempt.signal);
    await attempt.dispose();
    expect(runtime.connected).toBe(true);
    expect(runtime.currentHandshake?.server.daemonId).toBe('daemon-1');
    await runtime.probe(scope.signal);
    const first = peer.current;
    const generation = runtime.generation;
    runtime.detach();
    expect(first.closed).toBe(true);
    expect(runtime.currentHandshake).toBeUndefined();
    await expect(client.health(undefined)).rejects.toMatchObject({ code: 'DISCONNECTED' });
    peer.setDaemonId('daemon-2');
    await runtime.establish(target, scope.signal);
    expect(runtime.connection).toBe(connection);
    expect(runtime.client).toBe(client);
    expect(runtime.generation).toBeGreaterThan(generation);
    expect(runtime.currentHandshake?.server.daemonId).toBe('daemon-2');
    runtime.detach(generation);
    expect(runtime.connected).toBe(true);
    await expect(client.health(undefined)).resolves.toMatchObject({ status: 'ok' });
  });

  const worktreeInput = {
    workspaceId: 'fresh-worktree',
    repositoryId: 'repository',
    branch: 'feature/task',
    baseRef: 'origin/main',
    path: '/worktrees/fresh',
    preservePatterns: [],
    fetchLatestBase: true,
  };

  it('rejects a fresh-base request before sending it to an older server', async () => {
    peer.setProtocolVersion('12.0.0');
    await runtime.establish(target, scope.signal);
    await expect(
      runtime.client.workspaceRegistry.createWorktree(worktreeInput)
    ).rejects.toMatchObject({
      code: 'CONTRACT_MISMATCH',
      delivery: 'not-sent',
      message: expect.stringContaining('Please upgrade'),
    });
    await expect(
      runtime.client.workspaceRegistry.createWorktree({ ...worktreeInput, fetchLatestBase: false })
    ).rejects.toMatchObject({ code: 'UNKNOWN_PROCEDURE' });
  });

  it('sends a fresh-base request when the negotiated server minor supports it', async () => {
    await runtime.establish(target, scope.signal);
    // The peer only implements connection probes; reaching it proves the version gate passed.
    await expect(
      runtime.client.workspaceRegistry.createWorktree(worktreeInput)
    ).rejects.toMatchObject({
      code: 'UNKNOWN_PROCEDURE',
    });
  });

  it('rejects deployment with fresh-base automation runs on an older server', async () => {
    peer.setProtocolVersion('12.0.0');
    await runtime.establish(target, scope.signal);
    const deployment: Parameters<typeof runtime.client.automations.deploy>[0] = {
      automationId: 'automation-1',
      enabled: true,
      revision: 1,
      name: 'Review changes',
      schedule: { expr: '0 9 * * *', tz: 'UTC' },
      agent: { type: 'acp', start: { providerId: 'claude', initialQueue: [{ text: 'Review' }] } },
      workspace: {
        kind: 'worktree',
        repository: {
          host: { type: 'local', id: 'local' },
          path: { root: { kind: 'posix' }, segments: ['repo'] },
        },
        worktreePoolPath: { root: { kind: 'posix' }, segments: ['worktrees'] },
        baseRemote: 'origin',
        preservePatterns: [],
        git: {
          kind: 'create-branch',
          fromBranch: {
            type: 'remote',
            branch: 'main',
            remote: { name: 'origin', url: 'https://github.com/acme/repo.git' },
          },
          pushRemote: null,
          fetchLatestBase: true,
        },
      },
    };
    await expect(runtime.client.automations.deploy(deployment)).rejects.toMatchObject({
      code: 'CONTRACT_MISMATCH',
      delivery: 'not-sent',
    });
  });

  it.each(['open', 'initialize'] as const)(
    'bounds %s and disposes late resources without retrying',
    async (phase) => {
      const release = phase === 'open' ? peer.stallOpen() : peer.stallInitialize();
      const rejected = expect(runtime.establish(target, scope.signal)).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(101);
      await rejected;
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(runtime.connected).toBe(false);
      expect(peer.current.closed).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(peer.opens).toBe(1);
    }
  );

  describe.each(['open', 'initialize'] as const)('pending %s', (phase) => {
    it.each(['caller', 'detach', 'dispose'] as const)('is revoked by %s', async (cause) => {
      const release = phase === 'open' ? peer.stallOpen() : peer.stallInitialize();
      const caller = new AbortController();
      const rejected = expect(runtime.establish(target, caller.signal)).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(0);
      if (cause === 'caller') caller.abort();
      else if (cause === 'detach') runtime.detach();
      else await runtime.dispose();
      await rejected;
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(peer.current.closed).toBe(true);
      expect(runtime.connected).toBe(false);
      expect(runtime.currentHandshake).toBeUndefined();
    });
  });

  it('does not install an older attempt after a newer attempt succeeds', async () => {
    const release = peer.stallInitialize();
    const stale = expect(runtime.establish(target, scope.signal)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    const old = peer.current;
    release();
    peer.setDaemonId('daemon-2');
    await runtime.establish(target, scope.signal);
    await stale;
    expect(old.closed).toBe(true);
    expect(runtime.currentHandshake?.server.daemonId).toBe('daemon-2');
  });

  it('rejects health success if its transport was detached before the continuation runs', async () => {
    await runtime.establish(target, scope.signal);
    // Deliver success, then revoke the physical generation before its promise resumes.
    afterMessage = () => {
      afterMessage = undefined;
      queueMicrotask(() => runtime.detach());
    };
    await expect(runtime.probe(scope.signal)).rejects.toThrow('Superseded health response');
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it('reports RPC timeouts without deciding to replace or retry the connection', async () => {
    await runtime.establish(target, scope.signal);
    peer.current.dropReplies = true;
    const rejected = expect(
      runtime.client.health(undefined, { timeoutMs: 50 })
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(51);
    await rejected;
    expect(onRequestTimeout).toHaveBeenCalledOnce();
    expect(runtime.connected).toBe(true);
    expect(peer.opens).toBe(1);
  });
});
