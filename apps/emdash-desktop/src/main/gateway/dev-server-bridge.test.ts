import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDevServerBridgeParticipant } from './dev-server-bridge';

describe('createDevServerBridgeParticipant', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates one bridge per attached host and disposes each bridge on detach', async () => {
    const localTerminals = { host: 'local' };
    const remoteTerminals = { host: 'remote' };
    const localScripts = { host: 'local-scripts' };
    const remoteScripts = { host: 'remote-scripts' };
    const client = vi.fn(async (host: { type: string }) => ({
      success: true as const,
      data: {
        terminals: host.type === 'local' ? localTerminals : remoteTerminals,
        scripts: host.type === 'local' ? localScripts : remoteScripts,
      },
    }));
    const localBridge = { dispose: vi.fn(async () => {}) };
    const remoteBridge = { dispose: vi.fn(async () => {}) };
    const createBridge = vi
      .fn()
      .mockResolvedValueOnce(localBridge)
      .mockResolvedValueOnce(remoteBridge);
    const participant = createDevServerBridgeParticipant({
      runtimes: { client } as unknown as Pick<RuntimeBroker, 'client'>,
      createBridge,
    });
    const remoteHost = hostRef('remote', 'connection-1');

    await participant.attach(LOCAL_HOST_REF);
    await participant.attach(remoteHost);

    expect(client).toHaveBeenNthCalledWith(1, LOCAL_HOST_REF);
    expect(client).toHaveBeenNthCalledWith(2, remoteHost);
    expect(createBridge).toHaveBeenNthCalledWith(
      1,
      { terminals: localTerminals, scripts: localScripts },
      { transport: 'local' }
    );
    expect(createBridge).toHaveBeenNthCalledWith(
      2,
      { terminals: remoteTerminals, scripts: remoteScripts },
      { transport: 'ssh', connectionId: 'connection-1' }
    );

    await participant.detach(remoteHost);
    expect(remoteBridge.dispose).toHaveBeenCalledOnce();
    expect(localBridge.dispose).not.toHaveBeenCalled();

    await participant.detach(LOCAL_HOST_REF);
    expect(localBridge.dispose).toHaveBeenCalledOnce();
  });

  it('keeps the existing bridge when the same host attaches again', async () => {
    const bridge = { dispose: vi.fn(async () => {}) };
    const createBridge = vi.fn().mockResolvedValue(bridge);
    const participant = createDevServerBridgeParticipant({
      runtimes: {
        client: vi.fn(async () => ({ success: true, data: { terminals: {} } })) as never,
      },
      createBridge,
    });
    const host = hostRef('remote', 'connection-1');

    await participant.attach(host);
    await participant.attach(host);

    expect(createBridge).toHaveBeenCalledOnce();
    expect(bridge.dispose).not.toHaveBeenCalled();
    await participant.detach(host);
    expect(bridge.dispose).toHaveBeenCalledOnce();
  });

  it('retries a transient local bridge failure inside the attachment', async () => {
    vi.useFakeTimers();
    const bridge = { dispose: vi.fn(async () => {}) };
    const client = vi.fn(async () => ({ success: true, data: { terminals: {} } }));
    const createBridge = vi
      .fn()
      .mockRejectedValueOnce(new Error('bridge unavailable'))
      .mockResolvedValueOnce(bridge);
    const participant = createDevServerBridgeParticipant({
      runtimes: { client } as unknown as Pick<RuntimeBroker, 'client'>,
      createBridge,
    });

    const attaching = participant.attach(LOCAL_HOST_REF);
    await vi.advanceTimersByTimeAsync(1_000);
    await attaching;

    expect(client).toHaveBeenCalledTimes(2);
    expect(createBridge).toHaveBeenCalledTimes(2);
    await participant.detach(LOCAL_HOST_REF);
    expect(bridge.dispose).toHaveBeenCalledOnce();
  });

  it('retries a transient remote bridge failure inside the attachment', async () => {
    vi.useFakeTimers();
    const bridge = { dispose: vi.fn(async () => {}) };
    const client = vi.fn(async () => ({ success: true, data: { terminals: {} } }));
    const createBridge = vi
      .fn()
      .mockRejectedValueOnce(new Error('bridge unavailable'))
      .mockResolvedValueOnce(bridge);
    const participant = createDevServerBridgeParticipant({
      runtimes: { client } as unknown as Pick<RuntimeBroker, 'client'>,
      createBridge,
    });
    const host = hostRef('remote', 'connection-1');

    const attaching = participant.attach(host);
    await vi.advanceTimersByTimeAsync(1_000);
    await attaching;

    expect(client).toHaveBeenCalledTimes(2);
    expect(createBridge).toHaveBeenCalledTimes(2);
    await participant.detach(host);
    expect(bridge.dispose).toHaveBeenCalledOnce();
  });
});
