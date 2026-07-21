import { createScope } from '@emdash/shared/concurrency';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceServerConnection } from './connect/client-source';
import { createWorkspaceServerService } from './factory';
import type { SshWorkspaceServerTarget } from './targets';

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  cancel: vi.fn(async () => {}),
  ensure: vi.fn(),
  invalidateConnection: vi.fn(async () => {}),
  terminalErrorListener: undefined as
    | ((error: unknown, target: SshWorkspaceServerTarget) => void)
    | undefined,
}));

vi.mock('./connect/client-source', () => ({
  createWorkspaceServerClientSource: () => ({
    acquire: mocks.acquire,
    invalidateConnection: mocks.invalidateConnection,
    onTerminalError(listener: typeof mocks.terminalErrorListener) {
      mocks.terminalErrorListener = listener;
      return () => {
        mocks.terminalErrorListener = undefined;
      };
    },
  }),
}));

vi.mock('./provision/provisioner', () => ({
  WorkspaceServerProvisioner: class {
    ensure = mocks.ensure;
    cancel = mocks.cancel;
  },
}));

const target: SshWorkspaceServerTarget = {
  kind: 'ssh',
  sshConnectionId: 'ssh-1',
  socketPath: '/run/emdash/workspace-server.sock',
};

function connection(): WorkspaceServerConnection {
  return { target, client: {} } as WorkspaceServerConnection;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.terminalErrorListener = undefined;
  mocks.ensure.mockResolvedValue(target);
});

describe('workspace-server service pinned clients', () => {
  it('shares one pin, releases it on invalidation, and releases the replacement on dispose', async () => {
    const firstConnection = connection();
    const secondConnection = connection();
    const firstRelease = vi.fn(async () => {});
    const secondRelease = vi.fn(async () => {});
    mocks.acquire
      .mockReturnValueOnce({ ready: async () => firstConnection, release: firstRelease })
      .mockReturnValueOnce({ ready: async () => secondConnection, release: secondRelease });
    const parentScope = createScope({ label: 'workspace-server-factory-test' });
    const manager = { on: vi.fn(), off: vi.fn() };
    const service = createWorkspaceServerService({
      scope: parentScope,
      ssh: {
        manager: manager as never,
        ssh: { connect: vi.fn() },
        machines: { on: vi.fn(() => () => {}) },
      },
      artifacts: {} as never,
    });

    const [first, shared] = await Promise.all([service.client('ssh-1'), service.client('ssh-1')]);
    expect(first).toBe(firstConnection);
    expect(shared).toBe(firstConnection);
    expect(mocks.acquire).toHaveBeenCalledOnce();

    mocks.terminalErrorListener?.(new Error('terminal transport failed'), target);
    await vi.waitFor(() => expect(firstRelease).toHaveBeenCalledOnce());

    await expect(service.client('ssh-1')).resolves.toBe(secondConnection);
    expect(mocks.acquire).toHaveBeenCalledTimes(2);

    await service.dispose();
    expect(secondRelease).toHaveBeenCalledOnce();
    await parentScope.dispose();
  });
});
