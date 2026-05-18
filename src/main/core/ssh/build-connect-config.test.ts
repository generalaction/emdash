import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SshConnectionRow } from '@main/db/schema';
import { buildConnectConfigFromRow } from './build-connect-config';

const mocks = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  resolveSshConfigHostMock: vi.fn(),
  getPasswordMock: vi.fn(),
  getPassphraseMock: vi.fn(),
  buildProxyJumpSocketMock: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFileMock,
}));

vi.mock('@main/core/ssh/sshConfigParser', () => ({
  resolveSshConfigHost: mocks.resolveSshConfigHostMock,
}));

vi.mock('@main/core/ssh/ssh-credential-service', () => ({
  sshCredentialService: {
    getPassword: mocks.getPasswordMock,
    getPassphrase: mocks.getPassphraseMock,
  },
}));

vi.mock('./proxy-jump-sock', () => ({
  buildProxyJumpSocket: mocks.buildProxyJumpSocketMock,
}));

function makeRow(partial: Partial<SshConnectionRow>): SshConnectionRow {
  return {
    id: 'conn-1',
    name: 'Conn',
    host: 'example',
    port: 22,
    username: 'ubuntu',
    authType: 'agent',
    privateKeyPath: null,
    useAgent: 1,
    metadata: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...partial,
  };
}

describe('buildConnectConfigFromRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSshConfigHostMock.mockResolvedValue(undefined);
  });

  it('does not spawn ProxyJump socket when key loading fails', async () => {
    mocks.resolveSshConfigHostMock.mockResolvedValue({
      host: 'alias',
      hostname: '10.0.0.55',
      proxyJump: 'bastion',
    });
    mocks.readFileMock.mockRejectedValue(new Error('ENOENT: no such file or directory'));

    await expect(
      buildConnectConfigFromRow(
        makeRow({
          authType: 'key',
          privateKeyPath: '/missing/id_ed25519',
        })
      )
    ).rejects.toThrow('ENOENT');

    expect(mocks.buildProxyJumpSocketMock).not.toHaveBeenCalled();
  });

  it('attaches ProxyJump socket after auth config succeeds', async () => {
    const sock = new PassThrough();
    mocks.resolveSshConfigHostMock.mockResolvedValue({
      host: 'alias',
      hostname: '10.0.0.55',
      port: 2202,
      user: 'studio',
      proxyJump: 'jumpuser@bastion:2200',
    });
    mocks.getPasswordMock.mockResolvedValue('secret');
    mocks.buildProxyJumpSocketMock.mockReturnValue(sock);

    const config = await buildConnectConfigFromRow(
      makeRow({
        authType: 'password',
      })
    );

    expect(config).toMatchObject({
      host: '10.0.0.55',
      port: 2202,
      username: 'studio',
      password: 'secret',
    });
    expect(mocks.buildProxyJumpSocketMock).toHaveBeenCalledWith(
      '10.0.0.55',
      2202,
      'jumpuser@bastion:2200'
    );
    expect(config?.sock).toBe(sock);
  });
});
