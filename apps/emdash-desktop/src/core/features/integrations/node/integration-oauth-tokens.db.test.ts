import { err, ok } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmdashOAuthRenewer,
  EMDASH_OAUTH_CREDENTIAL_SOURCE,
  IntegrationOAuthTokens,
} from './integration-oauth-tokens';

const gitlabUser = vi.hoisted(() => ({ id: 7, username: 'tanuki', name: 'Tanuki' }));

vi.mock('@gitbeaker/rest', () => ({
  Gitlab: class {
    Users = { showCurrentUser: async () => gitlabUser };
  },
}));

const EXPIRES_AT = 1_800_000_000_000;
const providerAccount = {
  providerId: 'gitlab',
  providerAccountId: '7',
  host: 'gitlab.com',
  login: 'tanuki',
  avatarUrl: '',
};

describe('IntegrationOAuthTokens', () => {
  let fixture: RegistryFixture;
  let tokens: IntegrationOAuthTokens;

  beforeEach(async () => {
    gitlabUser.id = 7;
    fixture = await openRegistryFixture('empty');
    tokens = new IntegrationOAuthTokens(fixture.connections, log);
  });
  afterEach(() => fixture?.close());

  it('supports providers whose integration declares an oauth method', () => {
    expect(tokens.supports('github')).toBe(true);
    expect(tokens.supports('gitlab')).toBe(true);
    expect(tokens.supports('jira')).toBe(false);
  });

  it('connects a verified account from a server-issued token', async () => {
    const result = await tokens.store('gitlab', {
      accessToken: 'glo_server',
      expiresAt: EXPIRES_AT,
      providerAccount,
    });

    expect(result).toEqual({ providerAccountStatus: 'created', providerAccount });
    const account = await fixture.integrationAccounts.getAccount('gitlab');
    expect(account).toMatchObject({
      accountId: 'https://gitlab.com:7',
      displayName: 'Tanuki',
      credentialSource: EMDASH_OAUTH_CREDENTIAL_SOURCE,
      identity: { id: '7', login: 'tanuki', host: 'gitlab.com', scope: 'https://gitlab.com' },
      credentials: {
        instanceUrl: 'https://gitlab.com',
        accessToken: 'glo_server',
        expiresAt: EXPIRES_AT,
      },
    });
  });

  it('updates the account a device sign-in already connected', async () => {
    await fixture.connections.connectVerified(
      'gitlab',
      {
        connected: true,
        account: { id: '7', login: 'tanuki', host: 'gitlab.com', scope: 'https://gitlab.com' },
        credentials: {
          instanceUrl: 'https://gitlab.com',
          accessToken: 'glo_device',
          refreshToken: 'refresh',
          expiresAt: EXPIRES_AT,
        },
      },
      { credentialSource: 'device_flow' }
    );

    const result = await tokens.store('gitlab', { accessToken: 'glo_server', providerAccount });

    expect(result?.providerAccountStatus).toBe('updated');
    expect(await fixture.registry.listAccounts('gitlab')).toHaveLength(1);
    expect(await fixture.integrationAccounts.getAccount('gitlab')).toMatchObject({
      credentialSource: EMDASH_OAUTH_CREDENTIAL_SOURCE,
      credentials: { accessToken: 'glo_server' },
    });
  });

  it('rejects a token that belongs to another account', async () => {
    gitlabUser.id = 8;

    await expect(
      tokens.store('gitlab', { accessToken: 'glo_server', providerAccount })
    ).rejects.toThrow('The GitLab token belongs to a different account.');
    expect(await fixture.registry.listAccounts('gitlab')).toHaveLength(0);
  });

  it('ignores tokens without an account identity or for unsupported providers', async () => {
    await expect(tokens.store('gitlab', { accessToken: 'glo_server' })).resolves.toBeUndefined();
    await expect(
      tokens.store('jira', { accessToken: 'token', providerAccount })
    ).resolves.toBeUndefined();
  });
});

describe('createEmdashOAuthRenewer', () => {
  const account = {
    accountId: 'https://gitlab.com:7',
    identity: { id: '7', host: 'gitlab.com', scope: 'https://gitlab.com' },
    credentials: { instanceUrl: 'https://gitlab.com', accessToken: 'old', expiresAt: 1 },
  };

  it('asks the auth server for the linked account and maps the token', async () => {
    const renewToken = vi.fn(async () => ok({ accessToken: 'new', expiresAt: EXPIRES_AT }));

    const renewed = await createEmdashOAuthRenewer(renewToken)('gitlab', account, 0);

    expect(renewToken).toHaveBeenCalledWith('gitlab', '7');
    expect(renewed).toEqual(
      ok({ instanceUrl: 'https://gitlab.com', accessToken: 'new', expiresAt: EXPIRES_AT })
    );
  });

  it('asks to sign in to Emdash when the session is missing, and retries later', async () => {
    const renewed = await createEmdashOAuthRenewer(async () =>
      err({ type: 'not_signed_in', message: 'signed out' })
    )('gitlab', account, 0);

    expect(renewed).toEqual(
      err({ type: 'unavailable', message: 'Sign in to Emdash to keep GitLab connected.' })
    );
  });

  it('treats an unlinked account as rejected', async () => {
    const renewed = await createEmdashOAuthRenewer(async () =>
      err({ type: 'provider_account_not_linked', message: 'unlinked' })
    )('gitlab', account, 0);

    expect(renewed).toMatchObject({ success: false, error: { type: 'rejected' } });
  });
});
