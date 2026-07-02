import { PROTOCOL_VERSION } from '@emdash/core/workspace-server';
import { call, ORPCError } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { router } from './router';

describe('router', () => {
  it('health returns ok status', async () => {
    const result = await call(router.health, {});
    expect(result.status).toBe('ok');
    expect(typeof result.version).toBe('string');
    expect(typeof result.uptimeMs).toBe('number');
    expect(result.uptimeMs).toBeGreaterThanOrEqual(0);
  });
});

describe('initialize', () => {
  it('returns a successful hello for a compatible protocol version', async () => {
    const result = await call(router.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      client: { id: 'emdash-desktop', appVersion: '1.0.0' },
    });
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(typeof result.agreedVersion).toBe('string');
    expect(typeof result.agreedMinor).toBe('number');
    expect(typeof result.server.daemonId).toBe('string');
    expect(result.server.daemonId.length).toBeGreaterThan(0);
    expect(typeof result.server.startedAt).toBe('number');
  });

  it('negotiates down to the client minor when the client minor is lower', async () => {
    const [major] = PROTOCOL_VERSION.split('.');
    const olderMinor = `${major}.0.0`;
    const result = await call(router.initialize, {
      protocolVersion: olderMinor,
      client: { id: 'emdash-desktop', appVersion: '0.9.0' },
    });
    expect(result.agreedMinor).toBe(0);
  });

  it('throws PROTOCOL_INCOMPATIBLE with upgrade-client when client major is too old', async () => {
    await expect(
      call(router.initialize, {
        protocolVersion: '0.9.0',
        client: { id: 'emdash-desktop', appVersion: '0.1.0' },
      })
    ).rejects.toSatisfy((e: unknown) => {
      return (
        e instanceof ORPCError &&
        e.code === 'PROTOCOL_INCOMPATIBLE' &&
        (e.data as { action: string }).action === 'upgrade-client'
      );
    });
  });

  it('throws PROTOCOL_INCOMPATIBLE with upgrade-server when client major is too new', async () => {
    const [major] = PROTOCOL_VERSION.split('.');
    const futureVersion = `${Number(major) + 1}.0.0`;
    await expect(
      call(router.initialize, {
        protocolVersion: futureVersion,
        client: { id: 'emdash-desktop', appVersion: '9.9.0' },
      })
    ).rejects.toSatisfy((e: unknown) => {
      return (
        e instanceof ORPCError &&
        e.code === 'PROTOCOL_INCOMPATIBLE' &&
        (e.data as { action: string }).action === 'upgrade-server'
      );
    });
  });

  it('throws PROTOCOL_INCOMPATIBLE for an unparseable client version', async () => {
    await expect(
      call(router.initialize, {
        protocolVersion: 'garbage',
        client: { id: 'emdash-mobile', appVersion: '1.0.0' },
      })
    ).rejects.toSatisfy((e: unknown) => {
      return e instanceof ORPCError && e.code === 'PROTOCOL_INCOMPATIBLE';
    });
  });
});
