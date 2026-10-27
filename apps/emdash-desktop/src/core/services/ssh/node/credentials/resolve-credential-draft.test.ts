import { secret } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { SshConfig } from '@core/primitives/ssh/api/ssh';
import { resolveCredentialDraft } from './resolve-credential-draft';

const saved: SshConfig = {
  id: 'saved',
  name: 'Work',
  host: 'work.internal',
  port: 22,
  username: 'alice',
  authType: 'password',
};

function credentials() {
  return {
    getPassword: vi.fn(async () => secret('saved password')),
    getPassphrase: vi.fn(async () => secret('saved passphrase')),
  };
}

describe('resolveCredentialDraft', () => {
  it.each([
    { host: 'another.internal' },
    { port: 2222 },
    { username: 'bob' },
    { sshConfigAlias: 'another-alias' },
    { proxyJump: 'another-bastion' },
  ])('does not reuse a password after changing %j', async (change) => {
    const store = credentials();
    await expect(resolveCredentialDraft({ ...saved, ...change }, saved, store)).rejects.toThrow(
      'Enter a password'
    );
    expect(store.getPassword).not.toHaveBeenCalled();
  });

  it('requires a new password when switching from another authentication method', async () => {
    const store = credentials();
    await expect(
      resolveCredentialDraft(saved, { ...saved, authType: 'key' }, store)
    ).rejects.toThrow('Enter a password');
    expect(store.getPassword).not.toHaveBeenCalled();
  });

  it('retains the stored password when only the name changes', async () => {
    const store = credentials();
    const result = await resolveCredentialDraft(
      { ...saved, name: 'Renamed', password: '' },
      saved,
      store
    );
    expect(result.password?.expose()).toBe('saved password');
    expect(result.passphrase).toBeNull();
    expect(store.getPassword).toHaveBeenCalledWith('saved', expect.any(String));
  });

  it('uses an entered password without looking up the old secret or trimming it', async () => {
    const store = credentials();
    const result = await resolveCredentialDraft(
      { ...saved, host: 'another.internal', password: ' new password ' },
      saved,
      store
    );
    expect(result.password?.expose()).toBe(' new password ');
    expect(store.getPassword).not.toHaveBeenCalled();
  });

  it('reports a missing saved password instead of treating edit mode as sufficient', async () => {
    await expect(
      resolveCredentialDraft(saved, saved, {
        getPassword: async () => null,
        getPassphrase: async () => null,
      })
    ).rejects.toThrow('Enter a password');
  });

  it('does not look up secrets for a new connection', async () => {
    const store = credentials();
    await expect(resolveCredentialDraft(saved, undefined, store)).rejects.toThrow(
      'Enter a password'
    );
    expect(store.getPassword).not.toHaveBeenCalled();
  });

  it('retains a passphrase only for the same key selection', async () => {
    const store = credentials();
    const key = { ...saved, authType: 'key' as const, privateKeyPath: '/keys/old' };
    expect(
      (await resolveCredentialDraft(key, key, store, 'key-fingerprint')).passphrase?.expose()
    ).toBe('saved passphrase');
    store.getPassphrase.mockClear();
    const result = await resolveCredentialDraft(
      { ...key, privateKeyPath: '/keys/new' },
      key,
      store,
      'new-key-fingerprint'
    );
    expect(result.passphrase).toBeNull();
    expect(store.getPassphrase).not.toHaveBeenCalled();
  });

  it('does not inherit a passphrase when overriding or resetting the SSH config key', async () => {
    const store = credentials();
    const inherited = { ...saved, sshConfigAlias: 'work', authType: 'key' as const };
    const overridden = { ...inherited, privateKeyPath: '/keys/custom' };
    expect(
      (await resolveCredentialDraft(overridden, inherited, store, 'override')).passphrase
    ).toBeNull();
    expect(
      (await resolveCredentialDraft(inherited, overridden, store, 'inherited')).passphrase
    ).toBeNull();
    expect(store.getPassphrase).not.toHaveBeenCalled();
  });

  it('uses an entered passphrase for a replacement key', async () => {
    const store = credentials();
    const result = await resolveCredentialDraft(
      { ...saved, authType: 'key', privateKeyPath: '/keys/new', passphrase: ' new phrase ' },
      saved,
      store,
      'new-key-fingerprint'
    );
    expect(result.passphrase?.expose()).toBe(' new phrase ');
    expect(store.getPassphrase).not.toHaveBeenCalled();
  });

  it('ignores inactive secrets when selecting Agent', async () => {
    const store = credentials();
    const result = await resolveCredentialDraft(
      { ...saved, authType: 'agent', password: 'unused', passphrase: 'unused' },
      saved,
      store
    );
    expect(result).toMatchObject({ password: null, passphrase: null });
    expect(store.getPassword).not.toHaveBeenCalled();
    expect(store.getPassphrase).not.toHaveBeenCalled();
  });
});
