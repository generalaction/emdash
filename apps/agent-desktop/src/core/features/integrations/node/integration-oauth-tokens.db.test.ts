import { err, ok } from '@agent/shared';
import { log } from '@agent/shared/logger';
import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAgentOAuthRenewer,
  AGENT_OAUTH_CREDENTIAL_SOURCE,
  IntegrationOAuthTokens,
} from './integration-oauth-tokens';

const gitlabUser = vi.hoisted(() => ({ id: 7, username: 'tanuki', name: 'Tanuki' }));
const showCurrentUser = vi.hoisted(() => vi.fn());

vi.mock('@gitbeaker/rest', () => ({
  Gitlab: class {
    Users = { showCurrentUser: () => showCurrentUser() };
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
    showCurrentUser.mockReset();
    showCurrentUser.mockImplementation(async () => gitlabUser);
    fixture = await openRegistryFixture('empty');
    tokens = new IntegrationOAuthTokens(fixture.connections, log, { sleep: async () => {} });
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
      credentialSource: AGENT_OAUTH_CREDENTIAL_SOURCE,
      identity: { id: '7', login: 'tanuki', host: 'gitlab.com', scope: 'https://gitlab.com' },
      credentials: {
        instanceUrl: 'https://gitlab.com',
        accessToken: 'glo_server',
        expiresAt: EXPIRES_AT,
      },
    });
  });

  it('verifies a just-issued token once more before rejecting it', async () => {
    showCurrentUser.mockRejectedValueOnce(
      Object.assign(new Error('401 Unauthorized'), { cause: { response: { status: 401 } } })
    );

    const result = await tokens.store('gitlab', { accessToken: 'glo_server', providerAccount });

    expect(result?.providerAccountStatus).toBe('created');
    expect(showCurrentUser).toHaveBeenCalledTimes(2);
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
      credentialSource: AGENT_OAUTH_CREDENTIAL_SOURCE,
      credentials: { accessToken: 'glo_server' },
    });
  });

  it('does not save another identity when reconnecting the selected account', async () => {
    await tokens.store('gitlab', { accessToken: 'glo_first', providerAccount });
    gitlabUser.id = 8;

    await expect(
      tokens.store(
        'gitlab',
        {
          accessToken: 'glo_other',
          providerAccount: { ...providerAccount, providerAccountId: '8', login: 'other' },
        },
        { accountId: 'https://gitlab.com:7' }
      )
    ).rejects.toThrow('These credentials belong to a different account.');
    expect(await fixture.registry.listAccounts('gitlab')).toHaveLength(1);
    expect(await fixture.integrationAccounts.getAccount('gitlab')).toMatchObject({
      credentials: { accessToken: 'glo_first' },
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

describe('createAgentOAuthRenewer', () => {
  const account = {
    accountId: 'https://gitlab.com:7',
    identity: { id: '7', host: 'gitlab.com', scope: 'https://gitlab.com' },
    credentials: { instanceUrl: 'https://gitlab.com', accessToken: 'old', expiresAt: 1 },
  };

  it('asks the auth server for the linked account and maps the token', async () => {
    const renewToken = vi.fn(async () => ok({ accessToken: 'new', expiresAt: EXPIRES_AT }));

    const renewed = await createAgentOAuthRenewer(renewToken)('gitlab', account, 0);

    expect(renewToken).toHaveBeenCalledWith('gitlab', '7');
    expect(renewed).toEqual(
      ok({ instanceUrl: 'https://gitlab.com', accessToken: 'new', expiresAt: EXPIRES_AT })
    );
  });

  it('asks to sign in to Agent when the session is missing, and retries later', async () => {
    const renewed = await createAgentOAuthRenewer(async () =>
      err({ type: 'not_signed_in', message: 'signed out' })
    )('gitlab', account, 0);

    expect(renewed).toEqual(
      err({ type: 'unavailable', message: 'Sign in to Agent to keep GitLab connected.' })
    );
  });

  it('treats an unlinked account as rejected', async () => {
    const renewed = await createAgentOAuthRenewer(async () =>
      err({ type: 'provider_account_not_linked', message: 'unlinked' })
    )('gitlab', account, 0);

    expect(renewed).toMatchObject({ success: false, error: { type: 'rejected' } });
  });
});
