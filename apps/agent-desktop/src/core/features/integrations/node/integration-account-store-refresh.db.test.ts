import { err, ok } from '@agent/shared';
import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationAccountStore, type CredentialRenewer } from './integration-account-store';

const NOW = 1_800_000_000_000;
const ACCOUNT_ID = 'https://gitlab.com:42';

function oauth(expiresAt: number, suffix = '') {
  return {
    instanceUrl: 'https://gitlab.com',
    accessToken: `access${suffix}`,
    refreshToken: `refresh${suffix}`,
    expiresAt,
  };
}

function tokenResponse(suffix: string): Response {
  return new Response(
    JSON.stringify({
      access_token: `access${suffix}`,
      refresh_token: `refresh${suffix}`,
      expires_in: 7200,
    }),
    { status: 200 }
  );
}

describe('IntegrationAccountStore credential refresh', () => {
  let fixture: RegistryFixture;
  let store: IntegrationAccountStore;
  const fetch = vi.fn<typeof globalThis.fetch>();

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetch);
    fixture = await openRegistryFixture('empty');
    store = new IntegrationAccountStore(
      fixture.registry,
      async () => {},
      () => NOW
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fixture?.close();
  });

  async function seed(credentials: Record<string, unknown>) {
    await store.upsertAccount('gitlab', {
      accountId: ACCOUNT_ID,
      displayName: 'Tucker',
      identity: { id: '42', login: 'tdewitt', host: 'gitlab.com', scope: 'https://gitlab.com' },
      credentials: credentials as never,
    });
  }

  async function storedSecret() {
    return JSON.parse((await fixture.registry.resolveSecret('gitlab', ACCOUNT_ID)) ?? 'null');
  }

  it('returns current OAuth credentials without a request', async () => {
    await seed(oauth(NOW + 60 * 60 * 1000));
    expect((await store.getAccount('gitlab', ACCOUNT_ID))?.credentials).toEqual(
      oauth(NOW + 60 * 60 * 1000)
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never refreshes a personal access token', async () => {
    await seed({ instanceUrl: 'https://gitlab.com', apiToken: 'glpat' });
    await store.getAccount('gitlab', ACCOUNT_ID);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refreshes near-expiry credentials, persists the new pair, and keeps metadata', async () => {
    await seed(oauth(NOW + 60_000));
    fetch.mockResolvedValueOnce(tokenResponse('-2'));

    const account = await store.getAccount('gitlab', ACCOUNT_ID);

    expect(account?.credentials).toEqual(oauth(NOW + 7_200_000, '-2'));
    expect(await storedSecret()).toEqual(oauth(NOW + 7_200_000, '-2'));
    expect(account).toMatchObject({
      displayName: 'Tucker',
      identity: { id: '42', login: 'tdewitt', host: 'gitlab.com' },
    });
    const body = new URLSearchParams(
      String((fetch.mock.calls[0] as [string, RequestInit])[1].body)
    );
    expect(body.get('refresh_token')).toBe('refresh');
  });

  it('uses a single-use refresh token once when reads race', async () => {
    await seed(oauth(NOW + 60_000));
    fetch.mockResolvedValueOnce(tokenResponse('-2'));

    const accounts = await Promise.all([
      store.getAccount('gitlab', ACCOUNT_ID),
      store.getAccount('gitlab', ACCOUNT_ID),
      store.getAccount('gitlab', ACCOUNT_ID),
    ]);

    expect(fetch).toHaveBeenCalledTimes(1);
    for (const account of accounts) {
      expect(account?.credentials).toMatchObject({ accessToken: 'access-2' });
    }
  });

  it('returns the stored credentials when the provider is unreachable', async () => {
    await seed(oauth(NOW + 60_000));
    fetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    expect((await store.getAccount('gitlab', ACCOUNT_ID))?.credentials).toEqual(
      oauth(NOW + 60_000)
    );
    expect(await storedSecret()).toEqual(oauth(NOW + 60_000));
  });

  it('returns the stored credentials unchanged when the refresh is rejected', async () => {
    await seed(oauth(NOW + 60_000));
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    );

    expect((await store.getAccount('gitlab', ACCOUNT_ID))?.credentials).toEqual(
      oauth(NOW + 60_000)
    );
    expect(await storedSecret()).toEqual(oauth(NOW + 60_000));
  });

  it('does not retry a rejected refresh token on later reads', async () => {
    await seed(oauth(NOW + 60_000));
    fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    );

    await store.getAccount('gitlab', ACCOUNT_ID);
    await store.getAccount('gitlab', ACCOUNT_ID);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a refresh after the provider was unreachable', async () => {
    await seed(oauth(NOW + 60_000));
    fetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    fetch.mockResolvedValueOnce(tokenResponse('-2'));

    await store.getAccount('gitlab', ACCOUNT_ID);
    const account = await store.getAccount('gitlab', ACCOUNT_ID);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(account?.credentials).toMatchObject({ accessToken: 'access-2' });
  });

  it('refreshes again once rejected credentials are replaced', async () => {
    await seed(oauth(NOW + 60_000));
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    );
    await store.getAccount('gitlab', ACCOUNT_ID);

    await seed(oauth(NOW + 60_000, '-reconnected'));
    fetch.mockResolvedValueOnce(tokenResponse('-2'));
    const account = await store.getAccount('gitlab', ACCOUNT_ID);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(account?.credentials).toMatchObject({ accessToken: 'access-2' });
  });

  it('keeps rotated credentials that failed to save and saves them on the next read', async () => {
    await seed(oauth(NOW + 60_000));
    fetch.mockResolvedValueOnce(tokenResponse('-2'));
    vi.spyOn(fixture.registry, 'updateSecret').mockRejectedValueOnce(new Error('keychain'));

    const first = await store.getAccount('gitlab', ACCOUNT_ID);
    expect(first?.credentials).toEqual(oauth(NOW + 7_200_000, '-2'));
    expect(await storedSecret()).toEqual(oauth(NOW + 60_000));

    const second = await store.getAccount('gitlab', ACCOUNT_ID);
    expect(second?.credentials).toEqual(oauth(NOW + 7_200_000, '-2'));
    expect(await storedSecret()).toEqual(oauth(NOW + 7_200_000, '-2'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('drops unsaved credentials once the stored credentials change', async () => {
    await seed(oauth(NOW + 60_000));
    fetch.mockResolvedValueOnce(tokenResponse('-2'));
    vi.spyOn(fixture.registry, 'updateSecret').mockRejectedValueOnce(new Error('keychain'));
    await store.getAccount('gitlab', ACCOUNT_ID);

    await seed(oauth(NOW + 60 * 60 * 1000, '-reconnected'));
    const account = await store.getAccount('gitlab', ACCOUNT_ID);

    expect(account?.credentials).toEqual(oauth(NOW + 60 * 60 * 1000, '-reconnected'));
  });

  function pendingTokenResponse(suffix: string) {
    let respond!: () => void;
    fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          respond = () => resolve(tokenResponse(suffix));
        })
    );
    return () => respond();
  }

  it('does not recreate an account disconnected during a refresh', async () => {
    await seed(oauth(NOW + 60_000));
    const respond = pendingTokenResponse('-2');

    const read = store.getAccount('gitlab', ACCOUNT_ID);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await fixture.registry.removeAccount('gitlab', ACCOUNT_ID);
    respond();

    await expect(read).resolves.toBeNull();
    expect(await fixture.registry.getAccount('gitlab', ACCOUNT_ID)).toBeNull();
  });

  it('does not recreate an account disconnected while the renewed secret is written', async () => {
    await seed(oauth(NOW + 60_000));
    fetch.mockResolvedValueOnce(tokenResponse('-2'));
    const setSecret = fixture.secretStore.setSecret.bind(fixture.secretStore);
    vi.spyOn(fixture.secretStore, 'setSecret').mockImplementationOnce(async (key, value) => {
      await fixture.registry.removeAccount('gitlab', ACCOUNT_ID);
      await setSecret(key, value);
    });

    await expect(store.getAccount('gitlab', ACCOUNT_ID)).resolves.toBeNull();
    expect(await fixture.registry.getAccount('gitlab', ACCOUNT_ID)).toBeNull();
    expect(fixture.secretStore.secrets.size).toBe(0);
  });

  it('writes nothing for an upsert cancelled while it waited for a renewal', async () => {
    await seed(oauth(NOW + 60_000));
    const respond = pendingTokenResponse('-2');
    const read = store.getAccount('gitlab', ACCOUNT_ID);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

    const controller = new AbortController();
    const write = store.upsertAccount(
      'gitlab',
      { accountId: ACCOUNT_ID, credentials: oauth(NOW + 60 * 60 * 1000, '-device') as never },
      controller.signal
    );
    controller.abort();
    respond();

    await expect(write).resolves.toBeNull();
    await read;
    expect(await storedSecret()).toEqual(oauth(NOW + 7_200_000, '-2'));
  });

  it('keeps credentials replaced during a refresh', async () => {
    await seed(oauth(NOW + 60_000));
    const respond = pendingTokenResponse('-2');

    const read = store.getAccount('gitlab', ACCOUNT_ID);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await fixture.registry.upsertAccount({
      providerId: 'gitlab',
      accountId: ACCOUNT_ID,
      secret: JSON.stringify(oauth(NOW + 60 * 60 * 1000, '-reconnected')),
    });
    respond();

    expect((await read)?.credentials).toEqual(oauth(NOW + 60 * 60 * 1000, '-reconnected'));
    expect(await storedSecret()).toEqual(oauth(NOW + 60 * 60 * 1000, '-reconnected'));
  });

  describe('renewal by credential source', () => {
    function serverIssued(expiresAt: number, suffix = '') {
      return { instanceUrl: 'https://gitlab.com', accessToken: `access${suffix}`, expiresAt };
    }

    async function seedServerIssued(credentials: Record<string, unknown>) {
      await store.upsertAccount('gitlab', {
        accountId: ACCOUNT_ID,
        identity: { id: '42', login: 'tdewitt', host: 'gitlab.com', scope: 'https://gitlab.com' },
        credentialSource: 'emdash_oauth',
        credentials: credentials as never,
      });
    }

    it('renews through the registered renewer instead of the provider', async () => {
      const renew = vi.fn<CredentialRenewer>(async () => ok(serverIssued(NOW + 7_200_000, '-2')));
      store.setRenewer('emdash_oauth', renew);
      await seedServerIssued(serverIssued(NOW + 60_000));

      const account = await store.getAccount('gitlab', ACCOUNT_ID);

      expect(account?.credentials).toEqual(serverIssued(NOW + 7_200_000, '-2'));
      expect(await storedSecret()).toEqual(serverIssued(NOW + 7_200_000, '-2'));
      expect(renew).toHaveBeenCalledWith(
        'gitlab',
        expect.objectContaining({ identity: expect.objectContaining({ id: '42' }) }),
        NOW
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it('does not renew credentials that are still current', async () => {
      const renew = vi.fn<CredentialRenewer>();
      store.setRenewer('emdash_oauth', renew);
      await seedServerIssued(serverIssued(NOW + 60 * 60 * 1000));

      await store.getAccount('gitlab', ACCOUNT_ID);

      expect(renew).not.toHaveBeenCalled();
    });

    it('reports why renewal failed and retries on the next read', async () => {
      const renew = vi
        .fn<CredentialRenewer>()
        .mockResolvedValueOnce(
          err({ type: 'unavailable', message: 'Sign in to Agent to keep GitLab connected.' })
        )
        .mockResolvedValueOnce(ok(serverIssued(NOW + 7_200_000, '-2')));
      store.setRenewer('emdash_oauth', renew);
      await seedServerIssued(serverIssued(NOW + 60_000));

      expect(await store.getAccount('gitlab', ACCOUNT_ID)).toMatchObject({
        credentials: serverIssued(NOW + 60_000),
        renewalError: 'Sign in to Agent to keep GitLab connected.',
      });
      const renewed = await store.getAccount('gitlab', ACCOUNT_ID);

      expect(renew).toHaveBeenCalledTimes(2);
      expect(renewed?.credentials).toEqual(serverIssued(NOW + 7_200_000, '-2'));
      expect(renewed?.renewalError).toBeUndefined();
    });

    it('does not retry a rejected renewal until the credentials change', async () => {
      const renew = vi.fn<CredentialRenewer>(async () =>
        err({ type: 'rejected', message: 'GitLab is no longer linked.' })
      );
      store.setRenewer('emdash_oauth', renew);
      await seedServerIssued(serverIssued(NOW + 60_000));

      await store.getAccount('gitlab', ACCOUNT_ID);
      const account = await store.getAccount('gitlab', ACCOUNT_ID);

      expect(renew).toHaveBeenCalledTimes(1);
      expect(account?.renewalError).toBe('GitLab is no longer linked.');
    });

    it('retries a rejected renewal after its failures are forgotten', async () => {
      const renew = vi
        .fn<CredentialRenewer>()
        .mockResolvedValueOnce(err({ type: 'rejected', message: 'GitLab is no longer linked.' }))
        .mockResolvedValueOnce(ok(serverIssued(NOW + 7_200_000, '-2')));
      store.setRenewer('emdash_oauth', renew);
      await seedServerIssued(serverIssued(NOW + 60_000));
      await store.getAccount('gitlab', ACCOUNT_ID);

      store.forgetRenewalFailures('emdash_oauth');
      const account = await store.getAccount('gitlab', ACCOUNT_ID);

      expect(renew).toHaveBeenCalledTimes(2);
      expect(account?.credentials).toEqual(serverIssued(NOW + 7_200_000, '-2'));
    });

    it('keeps failures of other credential sources when forgetting', async () => {
      store.setRenewer('emdash_oauth', vi.fn<CredentialRenewer>());
      await seed(oauth(NOW + 60_000));
      fetch.mockResolvedValue(
        new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
      );
      await store.getAccount('gitlab', ACCOUNT_ID);

      store.forgetRenewalFailures('emdash_oauth');
      await store.getAccount('gitlab', ACCOUNT_ID);

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('renews with the method of credentials a reconnect saved during the read', async () => {
      const renew = vi.fn<CredentialRenewer>(async () =>
        ok(serverIssued(NOW + 7_200_000, '-server'))
      );
      store.setRenewer('emdash_oauth', renew);
      await seedServerIssued(serverIssued(NOW + 60_000));
      // A device sign-in reconnect lands after the metadata read, before the account lock.
      let reconnect: (() => Promise<unknown>) | undefined = () =>
        store.upsertAccount('gitlab', {
          accountId: ACCOUNT_ID,
          identity: { id: '42', login: 'tdewitt', host: 'gitlab.com', scope: 'https://gitlab.com' },
          credentialSource: 'device_flow',
          credentials: oauth(NOW + 60_000, '-device') as never,
        });
      const getRegistryAccount = fixture.registry.getAccount.bind(fixture.registry);
      vi.spyOn(fixture.registry, 'getAccount').mockImplementation(async (providerId, accountId) => {
        const account = await getRegistryAccount(providerId, accountId);
        const pending = reconnect;
        reconnect = undefined;
        await pending?.();
        return account;
      });
      fetch.mockResolvedValueOnce(tokenResponse('-2'));

      const account = await store.getAccount('gitlab', ACCOUNT_ID);

      expect(renew).not.toHaveBeenCalled();
      const body = new URLSearchParams(
        String((fetch.mock.calls[0] as [string, RequestInit])[1].body)
      );
      expect(body.get('refresh_token')).toBe('refresh-device');
      expect(account).toMatchObject({
        credentialSource: 'device_flow',
        credentials: oauth(NOW + 7_200_000, '-2'),
      });
      expect(await storedSecret()).toEqual(oauth(NOW + 7_200_000, '-2'));
    });
  });

  describe('rejected credentials', () => {
    function serverIssued(expiresAt: number, suffix = '') {
      return { instanceUrl: 'https://gitlab.com', accessToken: `access${suffix}`, expiresAt };
    }

    async function seedServerIssued(credentials: Record<string, unknown>) {
      await store.upsertAccount('gitlab', {
        accountId: ACCOUNT_ID,
        identity: { id: '42', login: 'tdewitt', host: 'gitlab.com', scope: 'https://gitlab.com' },
        credentialSource: 'emdash_oauth',
        credentials: credentials as never,
      });
    }

    it('renews rejected credentials once before they expire', async () => {
      const renew = vi.fn<CredentialRenewer>(async () => ok(serverIssued(NOW + 7_200_000, '-2')));
      store.setRenewer('emdash_oauth', renew);
      const current = serverIssued(NOW + 60 * 60 * 1000);
      await seedServerIssued(current);
      await store.getAccount('gitlab', ACCOUNT_ID);
      expect(renew).not.toHaveBeenCalled();

      await expect(store.reportRejected('gitlab', ACCOUNT_ID, current)).resolves.toBe(true);
      const renewed = await store.getAccount('gitlab', ACCOUNT_ID);

      expect(renew).toHaveBeenCalledTimes(1);
      expect(renewed?.credentials).toEqual(serverIssued(NOW + 7_200_000, '-2'));
    });

    it('forces at most one renewal per rejected token', async () => {
      const current = serverIssued(NOW + 60 * 60 * 1000);
      const renew = vi.fn<CredentialRenewer>(async () => ok(current));
      store.setRenewer('emdash_oauth', renew);
      await seedServerIssued(current);

      await expect(store.reportRejected('gitlab', ACCOUNT_ID, current)).resolves.toBe(true);
      await store.getAccount('gitlab', ACCOUNT_ID);
      await expect(store.reportRejected('gitlab', ACCOUNT_ID, current)).resolves.toBe(false);
      await store.getAccount('gitlab', ACCOUNT_ID);

      expect(renew).toHaveBeenCalledTimes(1);
    });

    it('does not renew credentials that were already replaced', async () => {
      const renew = vi.fn<CredentialRenewer>();
      store.setRenewer('emdash_oauth', renew);
      await seedServerIssued(serverIssued(NOW + 60 * 60 * 1000, '-2'));

      await expect(
        store.reportRejected('gitlab', ACCOUNT_ID, serverIssued(NOW + 60 * 60 * 1000))
      ).resolves.toBe(true);
      await store.getAccount('gitlab', ACCOUNT_ID);

      expect(renew).not.toHaveBeenCalled();
    });

    it('keeps rejected credentials eligible after a temporary renewal failure', async () => {
      const current = serverIssued(NOW + 60 * 60 * 1000);
      const renew = vi
        .fn<CredentialRenewer>()
        .mockResolvedValueOnce(err({ type: 'unavailable', message: 'Could not renew GitLab.' }))
        .mockResolvedValueOnce(ok(serverIssued(NOW + 7_200_000, '-2')));
      store.setRenewer('emdash_oauth', renew);
      await seedServerIssued(current);
      await store.reportRejected('gitlab', ACCOUNT_ID, current);

      expect(await store.getAccount('gitlab', ACCOUNT_ID)).toMatchObject({
        credentials: current,
        renewalError: 'Could not renew GitLab.',
      });
      await expect(store.reportRejected('gitlab', ACCOUNT_ID, current)).resolves.toBe(true);
      const renewed = await store.getAccount('gitlab', ACCOUNT_ID);

      expect(renew).toHaveBeenCalledTimes(2);
      expect(renewed?.credentials).toEqual(serverIssued(NOW + 7_200_000, '-2'));
    });

    it('ignores rejected credentials that do not expire', async () => {
      const token = { instanceUrl: 'https://gitlab.com', apiToken: 'glpat' };
      await seed(token);

      await expect(store.reportRejected('gitlab', ACCOUNT_ID, token)).resolves.toBe(false);
      await store.getAccount('gitlab', ACCOUNT_ID);

      expect(fetch).not.toHaveBeenCalled();
    });
  });

  it('applies a reconnect after an in-flight refresh of the same account', async () => {
    await seed(oauth(NOW + 60_000));
    const respond = pendingTokenResponse('-2');

    const read = store.getAccount('gitlab', ACCOUNT_ID);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const reconnect = seed(oauth(NOW + 60 * 60 * 1000, '-reconnected'));
    respond();
    await Promise.all([read, reconnect]);

    expect(await storedSecret()).toEqual(oauth(NOW + 60 * 60 * 1000, '-reconnected'));
  });
});
