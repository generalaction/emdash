import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type * as WireModule from '@emdash/wire';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AcpAuthLoginBinding } from './auth-login-binding';

const runtimeClient = vi.hoisted(() => ({
  current: undefined as unknown,
}));

vi.mock('./client', () => ({
  getAgentsClient: () => Promise.resolve(runtimeClient.current),
}));

vi.mock('@emdash/wire', async (importOriginal) => {
  const actual = await importOriginal<typeof WireModule>();
  return {
    ...actual,
    ReplicaState: class {
      readonly ready = Promise.resolve();
      readonly dispose = vi.fn(async () => {});
      current() {
        return {
          provider: {
            auth: { status: { kind: 'unknown' }, login: null },
          },
        };
      }
    },
    ReplicaLog: class {
      readonly ready = Promise.resolve();
      readonly dispose = vi.fn(async () => {});
    },
  };
});

describe('AcpAuthLoginBinding', () => {
  beforeEach(() => {
    runtimeClient.current = createClient();
  });

  it('routes login calls through the explicit host', async () => {
    const client = runtimeClient.current as ReturnType<typeof createClient>;
    const binding = await AcpAuthLoginBinding.create(createArgs());

    expect(client.startLogin).toHaveBeenCalledWith(
      {
        host: LOCAL_HOST_REF,
        providerId: 'provider',
        methodId: 'browser',
      },
      expect.anything()
    );
    expect(client.auth.state).toHaveBeenCalledWith({ host: LOCAL_HOST_REF }, 'list');
    expect(client.loginOutput.handle).toHaveBeenCalledWith({
      host: LOCAL_HOST_REF,
      providerId: 'provider',
    });
    await binding.dispose();
  });

  it('cancels login once during idempotent disposal', async () => {
    const client = runtimeClient.current as ReturnType<typeof createClient>;
    const binding = await AcpAuthLoginBinding.create(createArgs());

    await Promise.all([binding.dispose(), binding.dispose()]);

    expect(client.cancelLogin).toHaveBeenCalledTimes(1);
    expect(client.cancelLogin).toHaveBeenCalledWith({
      host: LOCAL_HOST_REF,
      providerId: 'provider',
    });
  });

  it('honors dispose(false) without cancelling the login', async () => {
    const client = runtimeClient.current as ReturnType<typeof createClient>;
    const binding = await AcpAuthLoginBinding.create(createArgs());

    await binding.dispose(false);

    expect(client.cancelLogin).not.toHaveBeenCalled();
  });

  it('keeps resize latest-wins by cancelling the previous resize run', async () => {
    const client = runtimeClient.current as ReturnType<typeof createClient>;
    const signals: AbortSignal[] = [];
    client.resizeLogin.mockImplementation((_input: unknown, meta?: RpcMeta) => {
      if (!meta) throw new Error('Expected resize metadata');
      signals.push(meta.signal as AbortSignal);
      return new Promise<{ success: boolean; data: undefined }>((resolve, reject) => {
        meta.signal?.addEventListener('abort', () => reject(meta.signal?.reason), { once: true });
        if (signals.length === 2) resolve({ success: true, data: undefined });
      });
    });
    const binding = await AcpAuthLoginBinding.create(createArgs());

    binding.resize(80, 24);
    await Promise.resolve();
    binding.resize(120, 40);
    await Promise.resolve();

    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    await binding.dispose();
  });
});

function createArgs(): Parameters<typeof AcpAuthLoginBinding.create>[0] {
  return {
    host: LOCAL_HOST_REF,
    providerId: 'provider',
    methodId: 'browser',
    terminal: {
      reset: vi.fn(),
      write: vi.fn(),
    },
  };
}

function createClient() {
  return {
    startLogin: vi.fn(async (_input: unknown, _meta?: RpcMeta) => ({
      success: true,
      data: undefined,
    })),
    cancelLogin: vi.fn(async (_input: unknown) => ({ success: true, data: undefined })),
    sendLoginInput: vi.fn(async (_input: unknown, _meta?: RpcMeta) => ({
      success: true,
      data: undefined,
    })),
    resizeLogin: vi.fn(async (_input: unknown, _meta?: RpcMeta) => ({
      success: true,
      data: undefined,
    })),
    markUrlHandled: vi.fn(async (_input: unknown, _meta?: RpcMeta) => ({
      success: true,
      data: undefined,
    })),
    auth: {
      state: vi.fn(() => ({})),
    },
    loginOutput: {
      handle: vi.fn(() => ({})),
    },
  };
}

type RpcMeta = {
  signal?: AbortSignal;
};
