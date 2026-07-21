import { PROTOCOL_VERSION, type WireInitializeResult } from '@emdash/core/workspace-server';
import { createScope } from '@emdash/shared/concurrency';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceServerProtocolError } from '../connect/protocol';
import { WorkspaceServerInstallError } from './installer';
import { WorkspaceServerProvisioner } from './provisioner';
import { WorkspaceServerProvisioningModel } from './provisioning-model';

describe('WorkspaceServerProvisioner', () => {
  it('coalesces compatible fast-path ensures without installing or starting', async () => {
    const fixture = createProvisionerFixture();
    const first = fixture.provisioner.ensure('ssh-1');
    const second = fixture.provisioner.ensure('ssh-1');

    await expect(first).resolves.toMatchObject({
      kind: 'ssh',
      sshConnectionId: 'ssh-1',
      socketPath: '/home/devuser/.emdash/workspace-server/run/workspace.sock',
    });
    await expect(second).resolves.toEqual(await first);
    expect(first).toBe(second);
    expect(fixture.installer.install).not.toHaveBeenCalled();
    expect(fixture.daemon.start).not.toHaveBeenCalled();
    expect(fixture.status('ssh-1')).toEqual({ phase: 'ready' });
    await fixture.dispose();
  });

  it('installs and starts an absent daemon before returning a ready target', async () => {
    const fixture = createProvisionerFixture();
    fixture.dialOnce.mockRejectedValueOnce(new Error('socket missing'));

    await expect(fixture.provisioner.ensure('ssh-1')).resolves.toMatchObject({ kind: 'ssh' });

    expect(fixture.installer.install).toHaveBeenCalledOnce();
    expect(fixture.daemon.start).toHaveBeenCalledOnce();
    expect(fixture.daemon.restart).not.toHaveBeenCalled();
    expect(fixture.dialOnce).toHaveBeenCalledTimes(2);
    expect(fixture.status('ssh-1')).toEqual({ phase: 'ready' });
    await fixture.dispose();
  });

  it('reinstalls and restarts when the handshake requires a server upgrade', async () => {
    const fixture = createProvisionerFixture();
    fixture.dialOnce.mockRejectedValueOnce(
      new WorkspaceServerProtocolError({
        code: 'protocol-incompatible',
        action: 'upgrade-server',
        clientProtocolVersion: '5.0.0',
        serverProtocolVersion: '4.0.0',
      })
    );

    await fixture.provisioner.ensure('ssh-1');

    expect(fixture.installer.install).toHaveBeenCalledOnce();
    expect(fixture.daemon.restart).toHaveBeenCalledOnce();
    expect(fixture.daemon.start).not.toHaveBeenCalled();
    await fixture.dispose();
  });

  it('publishes typed failures and keeps them observable', async () => {
    const fixture = createProvisionerFixture();
    fixture.dialOnce.mockRejectedValueOnce(new Error('socket missing'));
    fixture.installer.install.mockRejectedValue(
      new WorkspaceServerInstallError('unsupported-platform', 'musl is unsupported')
    );

    await expect(fixture.provisioner.ensure('ssh-1')).rejects.toMatchObject({
      code: 'unsupported-platform',
    });
    expect(fixture.status('ssh-1')).toMatchObject({
      phase: 'failed',
      error: { code: 'unsupported-platform' },
    });
    await fixture.dispose();
  });

  it('cancels an in-flight host probe and removes its stale state', async () => {
    const fixture = createProvisionerFixture({ blockHostProbe: true });
    const pending = fixture.provisioner.ensure('ssh-1');
    const rejected = expect(pending).rejects.toThrow('cancelled for ssh-1');
    await Promise.resolve();

    await fixture.provisioner.cancel('ssh-1');

    await rejected;
    expect(fixture.status('ssh-1')).toBeUndefined();
    await fixture.dispose();
  });

  it('does not enter the install path when the initial dial is cancelled', async () => {
    const fixture = createProvisionerFixture({ blockDial: true });
    const pending = fixture.provisioner.ensure('ssh-1');
    const rejected = expect(pending).rejects.toThrow('cancelled for ssh-1');
    await Promise.resolve();

    await fixture.provisioner.cancel('ssh-1');

    await rejected;
    expect(fixture.installer.install).not.toHaveBeenCalled();
    expect(fixture.daemon.start).not.toHaveBeenCalled();
    await fixture.dispose();
  });
});

function createProvisionerFixture(options: { blockDial?: boolean; blockHostProbe?: boolean } = {}) {
  const scope = createScope({ label: 'workspace-server-provisioner-test' });
  const model = new WorkspaceServerProvisioningModel();
  const hostProbe = vi.fn((_connectionId: string, signal?: AbortSignal) => {
    if (!options.blockHostProbe) {
      return Promise.resolve({ home: '/home/devuser' });
    }
    return new Promise<never>((_resolve, reject) => {
      signal?.addEventListener(
        'abort',
        () => reject(signal.reason instanceof Error ? signal.reason : new Error('aborted')),
        { once: true }
      );
    });
  });
  const installer = {
    install: vi.fn(async () => {}),
  };
  const daemon = {
    start: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
  };
  const dialOnce = vi.fn((_target, dialOptions: { signal: AbortSignal }) => {
    if (!options.blockDial) return Promise.resolve(handshake());
    return new Promise<never>((_resolve, reject) => {
      dialOptions.signal.addEventListener(
        'abort',
        () =>
          reject(
            dialOptions.signal.reason instanceof Error
              ? dialOptions.signal.reason
              : new Error('aborted')
          ),
        { once: true }
      );
    });
  });
  const provisioner = new WorkspaceServerProvisioner({
    scope,
    ssh: { ensureProxy: vi.fn() },
    host: { probe: hostProbe } as never,
    installer: installer as never,
    daemon: daemon as never,
    model,
    wire: { dialOnce },
  });

  return {
    provisioner,
    installer,
    daemon,
    dialOnce,
    status(connectionId: string) {
      return model.instance.states.runtime.snapshot().data[connectionId];
    },
    async dispose() {
      model.dispose();
      await scope.dispose();
    },
  };
}

function handshake(): WireInitializeResult {
  return {
    protocolVersion: PROTOCOL_VERSION,
    agreedVersion: PROTOCOL_VERSION,
    agreedMinor: 0,
    server: { appVersion: '1.2.3', daemonId: 'daemon', startedAt: 1 },
  };
}
