import { hostRef } from '@emdash/core/primitives/host/api';
import { err, ok } from '@emdash/shared';
import type { LiveSource } from '@emdash/wire';
import { encodeTopic } from '@emdash/wire/api';
import { describe, expect, it, vi } from 'vitest';
import { agentsContract } from '../api';
import { createAgentsWireController } from './wire-controller';

const legacyOperations = vi.hoisted(() => ({
  list: vi.fn(async () => []),
}));

const remoteHost = hostRef('remote', 'ssh-1');

describe('createAgentsWireController', () => {
  it('maps a remote HostRef to the existing SSH connection identity', async () => {
    const hostDependencies = {};
    const client = vi.fn(async () => ok({ hostDependencies }));
    const controller = createAgentsWireController({
      operations: legacyOperations as never,
      runtimes: { client } as never,
    });

    await expect(controller.call('list', { host: remoteHost })).resolves.toEqual(ok([]));

    expect(client).toHaveBeenCalledWith(remoteHost);
    expect(legacyOperations.list).toHaveBeenCalledWith('ssh-1', hostDependencies);
  });

  it('routes login procedures by HostRef', async () => {
    const refreshAuthStatus = vi.fn(async () => ok({ kind: 'unknown' as const }));
    const startLogin = vi.fn(async () => ok(undefined));
    const client = vi.fn(async () => ok({ agentConfig: { refreshAuthStatus, startLogin } }));
    const controller = createAgentsWireController({
      operations: legacyOperations as never,
      runtimes: { client } as never,
    });

    await expect(
      controller.call('refreshAuthStatus', { host: remoteHost, providerId: 'claude' })
    ).resolves.toEqual(ok({ kind: 'unknown' }));
    await expect(
      controller.call('startLogin', {
        host: remoteHost,
        providerId: 'claude',
        methodId: 'browser',
      })
    ).resolves.toEqual(ok(undefined));

    expect(client).toHaveBeenNthCalledWith(1, remoteHost);
    expect(client).toHaveBeenNthCalledWith(2, remoteHost);
    expect(refreshAuthStatus).toHaveBeenCalledWith({ providerId: 'claude' }, {});
    expect(startLogin).toHaveBeenCalledWith({ providerId: 'claude', methodId: 'browser' }, {});
  });

  it('returns RuntimeResolveError from fallible login procedures', async () => {
    const resolveError = {
      type: 'host-unavailable' as const,
      host: remoteHost,
      message: 'Remote runtime sessions are not enabled',
    };
    const controller = createAgentsWireController({
      operations: legacyOperations as never,
      runtimes: {
        client: async () => err(resolveError),
      } as never,
    });

    await expect(
      controller.call('startLogin', {
        host: remoteHost,
        providerId: 'claude',
        methodId: 'browser',
      })
    ).resolves.toEqual(err(resolveError));
  });

  it('returns RuntimeResolveError from installation status procedures', async () => {
    const resolveError = {
      type: 'host-unavailable' as const,
      host: remoteHost,
      message: 'Remote runtime sessions are not enabled',
    };
    const controller = createAgentsWireController({
      operations: legacyOperations as never,
      runtimes: {
        client: async () => err(resolveError),
      } as never,
    });

    await expect(
      controller.call('listAgentInstallationStatus', { host: remoteHost })
    ).resolves.toEqual(err(resolveError));
  });

  it('passes the active host dependency client to install operations', async () => {
    const hostDependencies = {};
    const install = vi.fn(async () => ({ success: true as const, data: {} }));
    const client = vi.fn(async () => ok({ hostDependencies }));
    const controller = createAgentsWireController({
      operations: { install } as never,
      runtimes: { client } as never,
    });

    await expect(
      controller.call('install', { host: remoteHost, id: 'claude', method: 'curl' })
    ).resolves.toEqual(ok({ success: true, data: {} }));

    expect(client).toHaveBeenCalledWith(remoteHost);
    expect(install).toHaveBeenCalledWith('claude', 'ssh-1', 'curl', hostDependencies);
  });

  it('forwards login output without copying', async () => {
    const update = {
      generation: 1,
      sequence: 1,
      timestamp: 1,
      data: { baseOffset: 0, append: 'login output' },
    };
    const source = loginSource(update);
    const asLiveSource = vi.fn(() => source);
    const handle = vi.fn(() => ({ asLiveSource }));
    const client = vi.fn(async () => ok({ agentConfig: { loginOutput: { handle } } }));
    const controller = createAgentsWireController({
      operations: legacyOperations as never,
      runtimes: { client } as never,
    });
    const key = { host: remoteHost, providerId: 'claude' };
    const lease = controller.acquireLive(encodeTopic(agentsContract.loginOutput.id, key));

    const output = await lease?.ready();
    const received: unknown[] = [];
    const unsubscribe = await output?.subscribe((next) => received.push(next));

    expect(client).toHaveBeenCalledWith(remoteHost);
    expect(handle).toHaveBeenCalledWith({ providerId: 'claude' });
    expect(asLiveSource).toHaveBeenCalledOnce();
    expect(received[0]).toBe(update);

    unsubscribe?.();
    await lease?.release();
  });
});

function loginSource(update: unknown): LiveSource {
  return {
    snapshot: async () => ({
      generation: 1,
      sequence: 0,
      timestamp: 0,
      data: { baseOffset: 0, text: '', truncated: false },
    }),
    subscribe: (callback) => {
      callback(update as never);
      return () => {};
    },
  };
}
