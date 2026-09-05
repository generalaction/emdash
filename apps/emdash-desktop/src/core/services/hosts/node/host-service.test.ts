import { createScope } from '@emdash/shared/concurrency';
import { deferred } from '@emdash/shared/testing';
import { peek } from '@emdash/wire/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SshConnectionManagerEvent } from '@core/primitives/ssh/api/node/ssh-connection-manager';
import { createHostService } from './host-service';
import { createFaultPeer } from './testing/connection-supervisor-fixture';
import type * as DaemonModule from './workspace-server/provision/daemon-control';
import type * as InstallerModule from './workspace-server/provision/installer';
import type * as ProvisionerModule from './workspace-server/provision/provisioner';

const ports = vi.hoisted(() => ({
  prepare: vi.fn(),
  cancel: vi.fn(async () => {}),
  open: vi.fn(),
  drop: vi.fn(),
  probe: vi.fn(async () => ({ platform: 'posix', home: '/home/test' })),
  install: vi.fn(async (_options: { signal?: AbortSignal }) => {}),
  installedVersion: vi.fn(async () => '1.0.0'),
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
}));
vi.mock('./workspace-server/provision/host-probe', () => ({
  RemoteHostProbe: class {
    drop = ports.drop;
    probe = ports.probe;
  },
}));
vi.mock('./workspace-server/provision/installer', async (importOriginal) => ({
  ...(await importOriginal<typeof InstallerModule>()),
  WorkspaceServerInstaller: class {
    install = ports.install;
    installedVersion = ports.installedVersion;
  },
}));
vi.mock('./workspace-server/provision/daemon-control', async (importOriginal) => ({
  ...(await importOriginal<typeof DaemonModule>()),
  RemoteWorkspaceServerDaemon: class {
    start = ports.start;
    stop = ports.stop;
  },
}));
vi.mock('./workspace-server/provision/provisioner', async (importOriginal) => ({
  ...(await importOriginal<typeof ProvisionerModule>()),
  WorkspaceServerProvisioner: class {
    ensure = ports.prepare;
    cancel = ports.cancel;
    drop = ports.drop;
  },
}));
vi.mock('./workspace-server/connect/ssh-streamlocal-transport', () => ({
  openSshWorkspaceServerTransport: (...args: unknown[]) => ports.open(...args),
}));

describe('HostService production supervisor ownership', () => {
  let fixture: ReturnType<typeof createFixture>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    fixture = createFixture();
  });
  afterEach(async () => {
    await fixture.scope.dispose();
    await fixture.peer.dispose();
    vi.useRealTimers();
  });

  it.each(['disconnect', 'identity'] as const)(
    '%s cancels an installer and fences its late continuation',
    async (cause) => {
      const gate = deferred<void>();
      let signal: AbortSignal | undefined;
      ports.install.mockImplementationOnce(async (options) => {
        signal = options.signal;
        await gate.promise;
      });
      const pending = fixture.service.installServer('ssh-1');
      const rejected = expect(pending).rejects.toBeDefined();
      await vi.advanceTimersByTimeAsync(0);
      expect(signal).toBeDefined();
      if (cause === 'disconnect') await fixture.service.lifecycle.disconnect('ssh-1');
      else fixture.mutate();
      await vi.advanceTimersByTimeAsync(0);
      expect(signal?.aborted).toBe(true);
      gate.resolve();
      await rejected;
      await vi.advanceTimersByTimeAsync(0);
      expect(ports.start).not.toHaveBeenCalled();
      expect(peek(fixture.service.availability('ssh-1')).kind).not.toBe('ready');
      if (cause === 'identity') expect(fixture.service.stateModel.get('ssh-1')).toBeUndefined();
    }
  );

  it('publishes an actionable runtime pause after an explicit operation fails', async () => {
    ports.install.mockRejectedValueOnce(new Error('Download interrupted'));
    await expect(fixture.service.installServer('ssh-1')).rejects.toThrow('Download interrupted');
    expect(peek(fixture.service.availability('ssh-1'))).toMatchObject({
      kind: 'unavailable',
      recovery: 'manual',
      issue: { type: 'host-unavailable' },
    });
    fixture.service.wake('resume');
    await vi.advanceTimersByTimeAsync(0);
    expect(peek(fixture.service.availability('ssh-1'))).toMatchObject({
      kind: 'unavailable',
      recovery: 'manual',
    });
  });

  it('does not coalesce replacement-identity operations with a cancelled predecessor', async () => {
    const gate = deferred<void>();
    ports.install.mockImplementationOnce(async () => gate.promise);
    const old = fixture.service.installServer('ssh-1');
    const rejection = expect(old).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(0);
    fixture.mutate();
    await rejection;
    await fixture.service.installServer('ssh-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(peek(fixture.service.availability('ssh-1')).kind).toBe('ready');
    expect(ports.start).toHaveBeenCalledOnce();
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.start).toHaveBeenCalledOnce();
    expect(peek(fixture.service.availability('ssh-1')).kind).toBe('ready');
  });

  it('settles a timed-out installer before its adapter returns', async () => {
    const gate = deferred<void>();
    ports.install.mockImplementationOnce(async () => gate.promise);
    const pending = fixture.service.installServer('ssh-1');
    const rejection = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(120_001);
    await rejection;
    expect(peek(fixture.service.availability('ssh-1'))).toMatchObject({
      kind: 'unavailable',
      recovery: 'manual',
    });
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.start).not.toHaveBeenCalled();
  });

  it('keeps a successful Stop paused until an explicit Start restores the runtime', async () => {
    await fixture.service.stopServer('ssh-1');
    expect(peek(fixture.service.availability('ssh-1'))).toMatchObject({
      kind: 'unavailable',
      recovery: 'manual',
    });
    fixture.service.wake('resume');
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.peer.opens).toBe(0);
    await fixture.service.startServer('ssh-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(peek(fixture.service.availability('ssh-1')).kind).toBe('ready');
  });

  it('does not let Connect bypass an in-flight daemon operation', async () => {
    const gate = deferred<void>();
    ports.install.mockImplementationOnce(async () => gate.promise);
    const pending = fixture.service.installServer('ssh-1');
    const rejection = expect(pending).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(0);
    await expect(fixture.service.connection('ssh-1').requestConnect()).resolves.toMatchObject({
      success: false,
      error: { type: 'host-unavailable' },
    });
    expect(fixture.peer.opens).toBe(0);
    await fixture.service.lifecycle.disconnect('ssh-1');
    gate.resolve();
    await rejection;
  });

  it('does not hold RPC dispatch for future readiness or start recovery from a passive call', async () => {
    await expect(fixture.service.client('ssh-1', { waitForReady: false })).rejects.toMatchObject({
      type: 'host-unavailable',
    });
    expect(fixture.peer.opens).toBe(0);
    expect(fixture.establish).not.toHaveBeenCalled();
    fixture.service.demand('ssh-1', 'automatic', fixture.scope);
    await fixture.service.client('ssh-1');
    fixture.peer.current.disconnect();
    await expect(fixture.service.client('ssh-1', { waitForReady: false })).rejects.toMatchObject({
      type: 'host-unavailable',
    });
  });

  it('initializes the physical candidate before publishing readiness', async () => {
    const release = fixture.peer.stallInitialize();
    const ready = vi.fn();
    fixture.service.onReady(ready);
    fixture.service.demand('ssh-1', 'automatic', fixture.scope);
    const connection = fixture.service.client('ssh-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).not.toHaveBeenCalled();
    expect(peek(fixture.service.availability('ssh-1')).kind).not.toBe('ready');
    release();
    await vi.advanceTimersByTimeAsync(0);
    const attachment = await connection;
    expect(ready).toHaveBeenCalledWith('ssh-1', attachment);
    expect(peek(fixture.service.availability('ssh-1')).kind).toBe('ready');
  });

  it('restores SSH-only intent without provisioning a daemon', async () => {
    await fixture.service.lifecycle.ensureConnected('ssh-1');
    expect(fixture.establish).toHaveBeenCalledOnce();
    expect(ports.prepare).not.toHaveBeenCalled();
    expect(fixture.peer.opens).toBe(0);
  });

  it('preserves attachment identity through silent loss and explicit SSH close', async () => {
    fixture.service.demand('ssh-1', 'automatic', fixture.scope);
    const attachment = await fixture.service.client('ssh-1');
    fixture.peer.current.dropReplies = true;
    fixture.service.wake('resume');
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await fixture.service.client('ssh-1')).toBe(attachment);
    fixture.closeSsh();
    await vi.advanceTimersByTimeAsync(0);
    expect(await fixture.service.client('ssh-1')).toBe(attachment);
    expect(fixture.invalidations).toEqual([]);
  });

  it('disposes old machine identity but retains the observable availability seam and demand', async () => {
    fixture.service.demand('ssh-1', 'automatic', fixture.scope);
    const previous = await fixture.service.client('ssh-1');
    const state = fixture.service.availability('ssh-1');
    const generation = peek(state);
    fixture.mutate();
    expect(peek(state).kind).not.toBe('ready');
    await vi.advanceTimersByTimeAsync(0);
    const replacement = await fixture.service.client('ssh-1');
    expect(replacement).not.toBe(previous);
    expect(fixture.service.availability('ssh-1')).toBe(state);
    const next = peek(state);
    expect(generation.kind).toBe('ready');
    expect(next.kind).toBe('ready');
    if (generation.kind === 'ready' && next.kind === 'ready')
      expect(next.generation).toBeGreaterThan(generation.generation);
    expect(fixture.invalidations).toEqual([{ connectionId: 'ssh-1', reason: 'machine-mutation' }]);
    expect(ports.cancel).toHaveBeenCalledWith('ssh-1');
  });

  it('does not let background consumers undo explicit Disconnect', async () => {
    fixture.service.demand('ssh-1', 'automatic', fixture.scope);
    await fixture.service.client('ssh-1');
    await fixture.service.lifecycle.disconnect('ssh-1');
    const opens = fixture.peer.opens;
    expect(await fixture.service.lifecycle.ensureConnected('ssh-1')).toBe('disconnected');
    fixture.service.wake('resume');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.peer.opens).toBe(opens);
    expect(peek(fixture.service.availability('ssh-1')).kind).toBe('suspended');
  });

  it('isolates failing identity observers from other observers', async () => {
    const reached = vi.fn();
    fixture.service.onInvalidate(() => {
      throw new Error('Observer failed');
    });
    fixture.service.onInvalidate(reached);
    fixture.mutate();
    expect(reached).toHaveBeenCalledOnce();
  });
});

function createFixture() {
  const scope = createScope({ label: 'host-service-supervisor-test' });
  const peer = createFaultPeer();
  ports.prepare.mockResolvedValue({
    kind: 'ssh',
    sshConnectionId: 'ssh-1',
    socketPath: '/test.sock',
  });
  ports.open.mockImplementation(() => peer.openTransport());
  let connected = false;
  let intended = true;
  let sshEvent: ((event: SshConnectionManagerEvent) => void) | undefined;
  let mutation: ((event: { connectionId: string }) => void) | undefined;
  const proxy = {
    get isConnected() {
      return connected;
    },
  };
  const establish = vi.fn(async () => {
    connected = true;
    return proxy as never;
  });
  const service = createHostService({
    scope,
    ssh: {
      manager: {
        on: (_name: string, listener: (event: SshConnectionManagerEvent) => void) => {
          sshEvent = listener;
        },
        off() {},
        getProxy: () => proxy,
        dropConnection: async () => {
          connected = false;
        },
      } as never,
      control: {
        readIntent: async () => intended,
        writeIntent: async (_id, enabled) => {
          intended = enabled;
        },
        establish,
        reset: () => {
          connected = false;
        },
        probe: async () => {},
      },
    },
    machineEvents: {
      on: (_name, listener) => {
        mutation = listener;
        return () => {
          mutation = undefined;
        };
      },
    },
  });
  const invalidations: unknown[] = [];
  service.onInvalidate((event) => invalidations.push(event));
  return {
    scope,
    peer,
    service,
    establish,
    invalidations,
    mutate: () => mutation?.({ connectionId: 'ssh-1' }),
    closeSsh: () => {
      connected = false;
      sshEvent?.({ type: 'disconnected', connectionId: 'ssh-1' });
    },
  };
}
