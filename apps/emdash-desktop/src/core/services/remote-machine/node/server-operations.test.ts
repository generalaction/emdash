import { PROTOCOL_VERSION, type WireInitializeResult } from '@emdash/core/workspace-server';
import { createScope } from '@emdash/shared/concurrency';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceServerProtocolError } from '../../workspace-server/node/connect/protocol';
import { RemoteMachineServerOperations } from './server-operations';
import { RemoteMachineStateModel } from './state-model';

describe('RemoteMachineServerOperations', () => {
  it('reports a missing installation without dialing the workspace server', async () => {
    const fixture = createFixture();
    fixture.installer.installedVersion.mockResolvedValueOnce(undefined);

    await fixture.operations.refresh('ssh-1');

    expect(fixture.status('ssh-1')).toEqual({ status: 'not-installed' });
    expect(fixture.wire.dialOnce).not.toHaveBeenCalled();
    await fixture.dispose();
  });

  it('reports an installed but unreachable workspace server as stopped', async () => {
    const fixture = createFixture();
    fixture.wire.dialOnce.mockRejectedValueOnce(new Error('socket missing'));

    await fixture.operations.refresh('ssh-1');

    expect(fixture.status('ssh-1')).toEqual({ status: 'stopped', version: '1.2.3' });
    await fixture.dispose();
  });

  it('publishes handshake metadata for a healthy workspace server', async () => {
    const fixture = createFixture();

    await fixture.operations.refresh('ssh-1');

    expect(fixture.status('ssh-1')).toEqual({
      status: 'healthy',
      version: '1.2.3',
      startedAt: 100,
    });
    await fixture.dispose();
  });

  it('publishes protocol incompatibility as a typed failure', async () => {
    const fixture = createFixture();
    fixture.wire.dialOnce.mockRejectedValueOnce(
      new WorkspaceServerProtocolError({
        code: 'protocol-incompatible',
        action: 'upgrade-client',
        clientProtocolVersion: '2.0.0',
        serverProtocolVersion: '1.0.0',
      })
    );

    await fixture.operations.refresh('ssh-1');

    expect(fixture.status('ssh-1')).toMatchObject({
      status: 'failed',
      version: '1.2.3',
      error: { code: 'protocol-incompatible' },
    });
    await fixture.dispose();
  });

  it('invalidates the wire client before stopping the daemon', async () => {
    const fixture = createFixture();

    await fixture.operations.stop('ssh-1');

    expect(fixture.wire.invalidateConnection).toHaveBeenCalledWith('ssh-1');
    expect(fixture.daemon.stop).toHaveBeenCalledOnce();
    expect(fixture.status('ssh-1')).toEqual({ status: 'stopped', version: '1.2.3' });
    await fixture.dispose();
  });
});

function createFixture() {
  const scope = createScope({ label: 'remote-machine-server-operations-test' });
  const state = new RemoteMachineStateModel();
  const host = {
    probe: vi.fn(async () => ({ home: '/home/devuser' })),
  };
  const installer = {
    installedVersion: vi.fn(async () => '1.2.3' as string | undefined),
    install: vi.fn(async () => {}),
  };
  const daemon = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
  const wire = {
    dialOnce: vi.fn(async () => handshake()),
    invalidateConnection: vi.fn(async () => {}),
  };
  const operations = new RemoteMachineServerOperations({
    scope,
    state,
    host,
    installer,
    daemon,
    wire,
  });

  return {
    operations,
    installer,
    daemon,
    wire,
    status(connectionId: string) {
      return state.instance.states.runtime.snapshot().data[connectionId];
    },
    async dispose() {
      state.dispose();
      await scope.dispose();
    },
  };
}

function handshake(): WireInitializeResult {
  return {
    protocolVersion: PROTOCOL_VERSION,
    agreedVersion: PROTOCOL_VERSION,
    agreedMinor: 0,
    server: {
      appVersion: '1.2.3',
      daemonId: 'daemon-1',
      startedAt: 100,
    },
  };
}
