import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sshController } from './controller';

const mocks = vi.hoisted(() => {
  const state = {
    captureMock: vi.fn(),
    proxyDestroyMock: vi.fn(),
    resolveSshConfigHostMock: vi.fn(),
    clientConnectMock: vi.fn(),
    clientEndMock: vi.fn(),
    clientInstances: [] as Array<{
      emit: (event: string, ...args: unknown[]) => boolean;
    }>,
  };

  function TestClient(this: {
    connect?: typeof state.clientConnectMock;
    end?: typeof state.clientEndMock;
    on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
    emit?: (event: string, ...args: unknown[]) => boolean;
  }) {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    this.connect = state.clientConnectMock;
    this.end = state.clientEndMock;
    this.on = (event: string, listener: (...args: unknown[]) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return this;
    };
    this.emit = (event: string, ...args: unknown[]) => {
      const registered = listeners.get(event) ?? [];
      for (const listener of registered) {
        listener(...args);
      }
      return registered.length > 0;
    };
    state.clientInstances.push(this as { emit: (event: string, ...args: unknown[]) => boolean });
  }

  return {
    ...state,
    TestClient,
  };
});

vi.mock('ssh2', () => ({
  Client: mocks.TestClient,
}));

vi.mock('@main/core/ssh/proxy-jump-sock', () => ({
  buildProxyJumpSocket: vi.fn(() => ({
    destroy: mocks.proxyDestroyMock,
  })),
}));

vi.mock('@main/core/ssh/sshConfigParser', () => ({
  resolveSshConfigHost: mocks.resolveSshConfigHostMock,
}));

vi.mock('@main/lib/telemetry', () => ({
  capture: mocks.captureMock,
}));

vi.mock('@main/core/ssh/ssh-connection-manager', () => ({
  sshConnectionManager: {
    isConnected: vi.fn(),
    disconnect: vi.fn(),
    connect: vi.fn(),
    getConnectionState: vi.fn(),
    getAllConnectionStates: vi.fn(),
    getProxy: vi.fn(),
  },
}));

vi.mock('@main/core/ssh/sshCredentialService', () => ({
  sshCredentialService: {
    storePassword: vi.fn(),
    storePassphrase: vi.fn(),
    deleteAllCredentials: vi.fn(),
  },
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@main/db/schema', () => ({
  sshConnections: {
    id: 'sshConnections.id',
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: vi.fn(),
  },
}));

describe('sshController.testConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientInstances.length = 0;
    mocks.resolveSshConfigHostMock.mockResolvedValue({
      hostname: 'target.internal',
      port: 22,
      user: 'ubuntu',
      proxyJump: 'bastion.example.com',
    });
  });

  it('destroys the ProxyJump socket when ssh2 emits an error', async () => {
    const resultPromise = sshController.testConnection({
      id: 'connection-id',
      name: 'Connection',
      host: 'host-alias',
      port: 22,
      username: 'ubuntu',
      authType: 'password',
      password: 'secret',
      useAgent: false,
    });

    await Promise.resolve();

    const client = mocks.clientInstances[0];
    if (!client) {
      throw new Error('Expected SSH client to be constructed');
    }

    client.emit('error', new Error('permission denied'));

    await expect(resultPromise).resolves.toEqual({
      success: false,
      error: 'permission denied',
      debugLogs: expect.any(Array),
    });
    expect(mocks.proxyDestroyMock).toHaveBeenCalledTimes(1);
    expect(mocks.captureMock).toHaveBeenCalledWith('ssh_connection_attempted', {
      success: false,
    });
  });
});
