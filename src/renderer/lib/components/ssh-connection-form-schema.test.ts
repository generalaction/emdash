import { describe, expect, it } from 'vitest';
import {
  sshConnectionFormSchema,
  type SshConnectionFormValues,
} from './ssh-connection-form-schema';

const baseValues: SshConnectionFormValues = {
  name: 'Conn',
  host: 'dev.internal',
  port: 22,
  username: 'alice',
  authType: 'agent',
  password: '',
  privateKeyPath: '',
  passphrase: '',
  sshConfigAlias: '',
  forwardAgent: false,
  proxyJump: '',
  isEditing: false,
};

describe('sshConnectionFormSchema', () => {
  it('allows alias-backed key auth without a manually entered private key path', () => {
    expect(
      sshConnectionFormSchema.safeParse({
        ...baseValues,
        username: '',
        authType: 'key',
        privateKeyPath: '',
        sshConfigAlias: 'corp-dev',
      }).success
    ).toBe(true);
  });

  it('still requires a private key path for manual key auth', () => {
    const result = sshConnectionFormSchema.safeParse({
      ...baseValues,
      authType: 'key',
      privateKeyPath: '',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ['privateKeyPath'] })])
    );
  });

  it('requires username and password for manual password auth', () => {
    const result = sshConnectionFormSchema.safeParse({
      ...baseValues,
      username: '',
      authType: 'password',
      password: '',
      isEditing: false,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['username'] }),
        expect.objectContaining({ path: ['password'] }),
      ])
    );
  });

  it('allows SSH config aliases that are not valid hostnames', () => {
    expect(
      sshConnectionFormSchema.safeParse({
        ...baseValues,
        host: 'team/foo%bar@corp',
        username: '',
        sshConfigAlias: 'team/foo%bar@corp',
      }).success
    ).toBe(true);
  });

  it('validates the persisted SSH config alias instead of the display host', () => {
    const result = sshConnectionFormSchema.safeParse({
      ...baseValues,
      host: 'dev.internal',
      username: '',
      sshConfigAlias: '-oProxyCommand=evil',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ['sshConfigAlias'] })])
    );
  });

  it('still rejects invalid hostnames for manual connections', () => {
    const result = sshConnectionFormSchema.safeParse({
      ...baseValues,
      host: 'team/foo%bar@corp',
      sshConfigAlias: '',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ['host'] })])
    );
  });
});
