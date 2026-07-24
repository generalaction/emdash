import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { createScope } from '@emdash/shared/concurrency';
import { describe, expect, it, vi } from 'vitest';
import { createDevServerBridgeInstaller } from './dev-server-bridge';

vi.mock('@main/core/preview-servers/dev-server-bridge', () => ({
  createDevServerBridge: vi.fn(),
}));

describe('createDevServerBridgeInstaller', () => {
  it('cleans up failed attempts, retries, and owns the successful bridge until disposal', async () => {
    const scope = createScope();
    const cleanupOrder: string[] = [];
    const terminals = {};
    const client = vi.fn().mockResolvedValue({ success: true, data: { terminals } });
    const runtimes = { client } as Pick<RuntimeBroker, 'client'>;
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

    await install();
    expect(client).toHaveBeenCalledTimes(2);
    expect(createBridge).toHaveBeenCalledTimes(2);

    await scope.dispose();
    expect(bridge.dispose).toHaveBeenCalledOnce();
    expect(cleanupOrder).toEqual(['bridge']);
  });

  it('shares an in-flight installation', async () => {
    const scope = createScope();
    const ready = Promise.withResolvers<{
      success: true;
      data: { terminals: object };
    }>();
    const client = vi.fn(() => ready.promise);
    const runtimes = { client } as unknown as Pick<RuntimeBroker, 'client'>;
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

    expect(client).toHaveBeenCalledOnce();
    expect(createBridge).toHaveBeenCalledOnce();
    await scope.dispose();
  });
});
