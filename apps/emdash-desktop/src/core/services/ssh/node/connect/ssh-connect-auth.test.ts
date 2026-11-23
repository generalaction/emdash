import { secret } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { SshConfig } from '@core/primitives/ssh/api/ssh';
import { buildAuthConfig } from './ssh-connect-auth';
import type { SshConnectDeps } from './resolve-ssh-connect-config';

const twoFactor: SshConfig = {
  id: 'saved',
  name: 'TwoFA',
  host: 'work.internal',
  port: 2222,
  username: 'alice',
  authType: 'key+password',
  privateKeyPath: '/keys/work',
};

function deps() {
  return {
    readFile: vi.fn(async () => 'private key contents'),
    getPassword: vi.fn(async () => secret('second factor')),
    getPassphrase: vi.fn(async () => null),
    resolveSshConfig: vi.fn(async () => {
      throw new Error('not used in these tests');
    }),
    findSshConfigByHostName: vi.fn(async () => undefined),
    spawnProxyCommand: vi.fn(),
    spawnProxyJump: vi.fn(),
    createAgent: vi.fn(),
    env: {},
  } as SshConnectDeps;
}

describe('buildAuthConfig key+password (server 2FA)', () => {
    it('assembles key and password with the ordered publickey-then-password authHandler', async () => {
    const d = deps();
    const { config } = await buildAuthConfig(
      { kind: 'transient', config: twoFactor, previous: twoFactor },
      twoFactor,
      undefined,
      d
    );
    expect(config.privateKey).toBe('private key contents');
    expect(config.password).toBe('second factor');
    expect(config.authHandler).toEqual(['publickey', 'password']);
  });

  it('includes the key passphrase when present', async () => {
    const d = deps();
    d.getPassphrase = vi.fn(async () => secret('key phrase'));
    const { config } = await buildAuthConfig(
      { kind: 'transient', config: twoFactor, previous: twoFactor },
      twoFactor,
      undefined,
      d
    );
    expect(config.passphrase).toBe('key phrase');
    expect(config.password).toBe('second factor');
    expect(config.authHandler).toEqual(['publickey', 'password']);
  });

  it('fails with a clear error when no password is available', async () => {
    const d = deps();
    d.getPassword = vi.fn(async () => null);
    await expect(
      buildAuthConfig(
        { kind: 'transient', config: twoFactor, previous: undefined },
        twoFactor,
        undefined,
        d
      )
    ).rejects.toThrow('Enter a password');
  });
});
