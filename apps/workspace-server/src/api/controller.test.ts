import { PROTOCOL_VERSION } from '@emdash/core/workspace-server';
import { describe, expect, it } from 'vitest';
import { createWorkspaceWireController } from './controller';

describe('createWorkspaceWireController', () => {
  it('health returns ok status and protocol version', async () => {
    const controller = createWorkspaceWireController({
      appVersion: '1.2.3',
      daemonId: 'daemon-test',
      startedAt: Date.now(),
    });

    const result = await controller.call('health', undefined);

    expect(result).toMatchObject({
      status: 'ok',
      version: '1.2.3',
      protocolVersion: PROTOCOL_VERSION,
    });
    expect((result as { uptimeMs: number }).uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it('initializes compatible clients with the negotiated minor version', async () => {
    const controller = createWorkspaceWireController({
      appVersion: '1.2.3',
      daemonId: 'daemon-test',
      startedAt: 100,
    });
    const [major] = PROTOCOL_VERSION.split('.');

    const result = await controller.call('initialize', {
      protocolVersion: `${major}.0.0`,
    });

    expect(result).toEqual({
      success: true,
      data: {
        protocolVersion: PROTOCOL_VERSION,
        agreedVersion: `${major}.0.0`,
        agreedMinor: 0,
        server: {
          appVersion: '1.2.3',
          daemonId: 'daemon-test',
          startedAt: 100,
        },
      },
    });
  });

  it('returns upgrade-client when the client major is too old', async () => {
    const controller = createWorkspaceWireController();

    const result = await controller.call('initialize', {
      protocolVersion: '0.9.0',
    });

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'protocol-incompatible',
        action: 'upgrade-client',
        clientProtocolVersion: '0.9.0',
        serverProtocolVersion: PROTOCOL_VERSION,
      },
    });
  });

  it('returns upgrade-server when the client major is too new', async () => {
    const controller = createWorkspaceWireController();
    const [major] = PROTOCOL_VERSION.split('.');
    const futureVersion = `${Number(major) + 1}.0.0`;

    const result = await controller.call('initialize', {
      protocolVersion: futureVersion,
    });

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'protocol-incompatible',
        action: 'upgrade-server',
        clientProtocolVersion: futureVersion,
        serverProtocolVersion: PROTOCOL_VERSION,
      },
    });
  });
});
