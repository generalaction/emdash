import { err, ok } from '@agent/shared';
import { describe, expect, it, vi } from 'vitest';
import type { IntegrationAccountRecord } from './integration-accounts';
import { createIntegrationCredentialReader } from './integration-credential-reader';

const gitlabCredentials = { instanceUrl: 'https://gitlab.com', apiToken: 'glpat' };

function reader(
  record: IntegrationAccountRecord | null,
  options: {
    exists?: boolean;
    overrides?: Parameters<typeof createIntegrationCredentialReader>[2];
  } = {}
) {
  const getAccount = vi.fn(async () => record);
  const lookup = vi.fn(async () => (options.exists ? ({} as never) : null));
  return {
    read: createIntegrationCredentialReader(
      { getAccount },
      { getAccount: lookup },
      options.overrides
    ),
    getAccount,
  };
}

describe('createIntegrationCredentialReader', () => {
  it('returns the stored record for the selected account', async () => {
    const { read, getAccount } = reader({
      accountId: 'gl-1',
      identity: { id: '1', host: 'gitlab.com' },
      credentials: gitlabCredentials,
    });
    await expect(read('gitlab', 'gl-1', 'GITLAB.com')).resolves.toEqual(ok(gitlabCredentials));
    expect(getAccount).toHaveBeenCalledWith('gitlab', 'gl-1');
  });

  it('fails closed when the account belongs to a different host', async () => {
    const { read } = reader({
      accountId: 'gl-1',
      identity: { id: '1', host: 'gitlab.example.com' },
      credentials: gitlabCredentials,
    });
    await expect(read('gitlab', 'gl-1', 'gitlab.com')).resolves.toMatchObject(
      err({ type: 'account_host_mismatch', accountHost: 'gitlab.example.com', host: 'gitlab.com' })
    );
  });

  it('distinguishes a removed account from one missing its credentials', async () => {
    await expect(reader(null).read('gitlab', 'gone', 'gitlab.com')).resolves.toMatchObject(
      err({ type: 'account_not_found', accountId: 'gone' })
    );
    await expect(
      reader(null, { exists: true }).read('gitlab', 'present', 'gitlab.com')
    ).resolves.toMatchObject(err({ type: 'token_missing', accountId: 'present' }));
  });

  it('does not look up an account for a blank id', async () => {
    const { read, getAccount } = reader(null);
    await expect(read('gitlab', '  ', 'gitlab.com')).resolves.toMatchObject(
      err({ type: 'account_not_found' })
    );
    expect(getAccount).not.toHaveBeenCalled();
  });

  it('delegates to an integration override', async () => {
    const override = vi.fn(async () =>
      ok({ accessToken: 't', apiBaseUrl: 'https://api.github.com' })
    );
    const { read, getAccount } = reader(null, { overrides: { github: override } });
    await expect(read('github', 'gh-1', 'github.com')).resolves.toEqual(
      ok({ accessToken: 't', apiBaseUrl: 'https://api.github.com' })
    );
    expect(override).toHaveBeenCalledWith('github', 'gh-1', 'github.com');
    expect(getAccount).not.toHaveBeenCalled();
  });
});
