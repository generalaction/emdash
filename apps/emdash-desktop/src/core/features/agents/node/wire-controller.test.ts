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

vi.mock('@main/core/agents/controller', () => ({ agentOperations: legacyOperations }));

const remoteHost = hostRef('remote', 'ssh-1');

describe('createAgentsWireController', () => {
  it('maps a remote HostRef to the existing SSH connection identity', async () => {
    const hostDependencies = {};
    const release = vi.fn(async () => {});
    const session = vi.fn(() => ({
      ready: async () => ok({ hostDependencies }),
      release,
    }));
    const controller = createAgentsWireController({ runtimes: { session } as never });

    await expect(controller.call('list', { host: remoteHost })).resolves.toEqual(ok([]));

    expect(session).toHaveBeenCalledWith(remoteHost);
    expect(legacyOperations.list).toHaveBeenCalledWith('ssh-1', hostDependencies);
    expect(release).toHaveBeenCalledOnce();
  });

  it('routes login procedures by HostRef and releases each call lease', async () => {
    const refreshAuthStatus = vi.fn(async () => ok({ kind: 'unknown' as const }));
    const startLogin = vi.fn(async () => ok(undefined));
    const release = vi.fn(async () => {});
    const session = vi.fn(() => ({
      ready: async () => ok({ agentConfig: { refreshAuthStatus, startLogin } }),
      release,
    }));
    const controller = createAgentsWireController({ runtimes: { session } as never });

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

    expect(session).toHaveBeenNthCalledWith(1, remoteHost);
    expect(session).toHaveBeenNthCalledWith(2, remoteHost);
    expect(refreshAuthStatus).toHaveBeenCalledWith({ providerId: 'claude' }, {});
    expect(startLogin).toHaveBeenCalledWith({ providerId: 'claude', methodId: 'browser' }, {});
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('returns RuntimeResolveError from fallible login procedures', async () => {
    const resolveError = {
      type: 'host-unavailable' as const,
      host: remoteHost,
      message: 'Remote runtime sessions are not enabled',
    };
    const release = vi.fn(async () => {});
    const controller = createAgentsWireController({
      runtimes: {
        session: () => ({
          ready: async () => err(resolveError),
          release,
        }),
      } as never,
    });

    await expect(
      controller.call('startLogin', {
        host: remoteHost,
        providerId: 'claude',
        methodId: 'browser',
      })
    ).resolves.toEqual(err(resolveError));
    expect(release).toHaveBeenCalledOnce();
  });

  it('returns RuntimeResolveError from installation status procedures', async () => {
    const resolveError = {
      type: 'host-unavailable' as const,
      host: remoteHost,
      message: 'Remote runtime sessions are not enabled',
    };
    const release = vi.fn(async () => {});
    const controller = createAgentsWireController({
      runtimes: {
        session: () => ({
          ready: async () => err(resolveError),
          release,
        }),
      } as never,
    });

    await expect(
      controller.call('listAgentInstallationStatus', { host: remoteHost })
    ).resolves.toEqual(err(resolveError));
    expect(release).toHaveBeenCalledOnce();
  });

  it('forwards login output without copying and holds its lease through attachment', async () => {
    const update = {
      generation: 1,
      sequence: 1,
      timestamp: 1,
      data: { baseOffset: 0, append: 'login output' },
    };
    const source = loginSource(update);
    const asLiveSource = vi.fn(() => source);
    const handle = vi.fn(() => ({ asLiveSource }));
    const release = vi.fn(async () => {});
    const session = vi.fn(() => ({
      ready: async () => ok({ agentConfig: { loginOutput: { handle } } }),
      release,
    }));
    const controller = createAgentsWireController({ runtimes: { session } as never });
    const key = { host: remoteHost, providerId: 'claude' };
    const lease = controller.acquireLive(encodeTopic(agentsContract.loginOutput.id, key));

    const output = await lease?.ready();
    const received: unknown[] = [];
    const unsubscribe = await output?.subscribe((next) => received.push(next));

    expect(session).toHaveBeenCalledWith(remoteHost);
    expect(handle).toHaveBeenCalledWith({ providerId: 'claude' });
    expect(asLiveSource).toHaveBeenCalledOnce();
    expect(received[0]).toBe(update);
    expect(release).not.toHaveBeenCalled();

    unsubscribe?.();
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
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
