import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { createScope } from '@emdash/shared/concurrency';
import { describe, expect, it, vi } from 'vitest';
import { createDevServerBridgeInstaller } from './dev-server-bridge';

vi.mock('@main/core/preview-servers/dev-server-bridge', () => ({
  createDevServerBridge: vi.fn(),
}));
vi.mock('./runtime-broker', () => ({
  getDesktopRuntimeBroker: () => ({ session: vi.fn() }),
}));

describe('createDevServerBridgeInstaller', () => {
  it('cleans up failed attempts, retries, and pins the successful session until disposal', async () => {
    const scope = createScope();
    const cleanupOrder: string[] = [];
    const terminals = {};
    const leases = [
      {
        ready: vi.fn().mockResolvedValue({ success: true, data: { terminals } }),
        release: vi.fn(async () => {
          cleanupOrder.push('failed-session');
        }),
      },
      {
        ready: vi.fn().mockResolvedValue({ success: true, data: { terminals } }),
        release: vi.fn(async () => {
          cleanupOrder.push('installed-session');
        }),
      },
    ];
    let leaseIndex = 0;
    const session = vi.fn(() => leases[leaseIndex++]);
    const runtimes = { session } as unknown as Pick<RuntimeBroker, 'session'>;
    const bridge = {
      dispose: vi.fn(async () => {
        cleanupOrder.push('bridge');
      }),
    };
    const createBridge = vi
      .fn()
      .mockRejectedValueOnce(new Error('bridge unavailable'))
      .mockResolvedValueOnce(bridge);
    const install = createDevServerBridgeInstaller({
      scope,
      runtimes,
      createBridge,
    });

    await expect(install()).rejects.toThrow('bridge unavailable');
    expect(leases[0].release).toHaveBeenCalledOnce();

    await install();
    expect(session).toHaveBeenCalledTimes(2);
    expect(createBridge).toHaveBeenCalledTimes(2);
    expect(leases[1].release).not.toHaveBeenCalled();

    await scope.dispose();
    expect(bridge.dispose).toHaveBeenCalledOnce();
    expect(leases[1].release).toHaveBeenCalledOnce();
    expect(cleanupOrder).toEqual(['failed-session', 'bridge', 'installed-session']);
  });

  it('shares an in-flight installation', async () => {
    const scope = createScope();
    const ready = Promise.withResolvers<{
      success: true;
      data: { terminals: object };
    }>();
    const release = vi.fn(async () => {});
    const session = vi.fn(() => ({ ready: () => ready.promise, release }));
    const runtimes = { session } as unknown as Pick<RuntimeBroker, 'session'>;
    const createBridge = vi.fn(async () => ({ dispose: async () => {} }));
    const install = createDevServerBridgeInstaller({
      scope,
      runtimes,
      createBridge,
    });

    const first = install();
    const second = install();
    expect(second).toBe(first);

    ready.resolve({ success: true, data: { terminals: {} } });
    await first;

    expect(session).toHaveBeenCalledOnce();
    expect(createBridge).toHaveBeenCalledOnce();
    await scope.dispose();
    expect(release).toHaveBeenCalledOnce();
  });
});
