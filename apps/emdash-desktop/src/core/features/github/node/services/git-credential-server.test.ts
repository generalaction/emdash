import { err, ok } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadGitHubCredentials } from '@core/features/github/api/node/services/github-credentials';
import type { GitHubAccountSummary } from '@core/primitives/github/api';
import type { Resolved } from '@core/primitives/project-settings/api';
import { GitCredentialServer } from './git-credential-server';

const SECRET_TOKEN = 'ghp_SECRET_TOKEN_MATERIAL_do_not_leak';

const account: GitHubAccountSummary = {
  providerId: 'github',
  displayName: '@octocat',
  accountId: 'account-1',
  host: 'github.com',
  login: 'octocat',
  avatarUrl: 'https://example.invalid/a.png',
  credentialSource: 'emdash_oauth',
  isDefault: true,
};

function makeHarness(
  options: {
    resolution?: Resolved<GitHubAccountSummary | null>;
    accounts?: GitHubAccountSummary[];
    credentialsResult?: Awaited<ReturnType<ReadGitHubCredentials>>;
  } = {}
) {
  const logLines: string[] = [];
  const record = (message: unknown, meta?: unknown) => {
    logLines.push(`${String(message)} ${JSON.stringify(meta ?? {})}`);
  };
  const logger = {
    info: record,
    warn: record,
    error: record,
    debug: record,
  } as unknown as Logger;
  const readCredentials = vi.fn<ReadGitHubCredentials>(
    async () =>
      options.credentialsResult ??
      ok({ accessToken: SECRET_TOKEN, apiBaseUrl: 'https://api.github.com' })
  );
  const server = new GitCredentialServer({
    resolveProjectIntegrationAccount: async () => ({
      ...(options.resolution ?? { value: account, provenance: { kind: 'set' as const } }),
      accounts: options.accounts ?? [account],
      contextKey: '',
    }),
    listAccounts: async () => options.accounts ?? [account],
    readCredentials,
    logger,
  });
  return { server, logLines, readCredentials };
}

async function requestCredential(
  channel: { port: number; nonce: string },
  body: string,
  nonceOverride?: string
): Promise<{ status: number; text: string }> {
  const response = await fetch(`http://127.0.0.1:${channel.port}/git-credential/get`, {
    method: 'POST',
    headers: { 'X-Emdash-Token': nonceOverride ?? channel.nonce },
    body,
  });
  return { status: response.status, text: await response.text() };
}

describe('GitCredentialServer', () => {
  const servers: GitCredentialServer[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.stop();
  });

  function track(harness: ReturnType<typeof makeHarness>) {
    servers.push(harness.server);
    return harness;
  }

  it('answers a project-session get with the effective account credentials', async () => {
    const { server, readCredentials } = track(makeHarness());
    const channel = await server.mintSession({ kind: 'project', projectId: 'project-1' });

    const result = await requestCredential(channel, 'protocol=https\nhost=github.com\n');
    expect(result.status).toBe(200);
    expect(readCredentials).toHaveBeenCalledWith('account-1', 'github.com');
    expect(result.text).toBe(`username=octocat\npassword=${SECRET_TOKEN}\n`);
    // The channel handle itself carries no token material.
    expect(JSON.stringify(channel)).not.toContain(SECRET_TOKEN);
  });

  it('rejects unknown and revoked nonces', async () => {
    const { server } = track(makeHarness());
    const channel = await server.mintSession({ kind: 'project', projectId: 'project-1' });

    const bad = await requestCredential(channel, 'protocol=https\nhost=github.com\n', 'wrong');
    expect(bad.status).toBe(403);
    expect(bad.text).toBe('');

    server.revokeSession(channel.nonce);
    const revoked = await requestCredential(channel, 'protocol=https\nhost=github.com\n');
    expect(revoked.status).toBe(403);
  });

  it('denies non-https requests and host mismatches', async () => {
    const { server } = track(makeHarness());
    const channel = await server.mintSession({ kind: 'project', projectId: 'project-1' });

    expect((await requestCredential(channel, 'protocol=http\nhost=github.com\n')).status).toBe(404);
    expect((await requestCredential(channel, 'protocol=https\nhost=evil.example\n')).status).toBe(
      404
    );
  });

  it('fails closed when the project account resolution yields no account', async () => {
    const { server } = track(
      makeHarness({ resolution: { value: null, provenance: { kind: 'unresolvable' } } })
    );
    const channel = await server.mintSession({ kind: 'project', projectId: 'project-1' });

    const result = await requestCredential(channel, 'protocol=https\nhost=github.com\n');
    expect(result.status).toBe(404);
    expect(result.text).toBe('');
  });

  it('fails closed when token resolution errors (stale pin)', async () => {
    const { server } = track(
      makeHarness({
        credentialsResult: err({
          type: 'account_not_found',
          host: 'github.com',
          accountId: 'account-1',
          message: 'Account removed',
        }),
      })
    );
    const channel = await server.mintSession({ kind: 'project', projectId: 'project-1' });

    const result = await requestCredential(channel, 'protocol=https\nhost=github.com\n');
    expect(result.status).toBe(404);
  });

  it('answers account sessions only for their selected account and host', async () => {
    const { server } = track(makeHarness());
    const channel = await server.mintSession({
      kind: 'account',
      accountId: 'account-1',
      host: 'github.com',
    });

    const match = await requestCredential(channel, 'protocol=https\nhost=github.com\n');
    expect(match.status).toBe(200);
    const mismatch = await requestCredential(channel, 'protocol=https\nhost=ghe.example\n');
    expect(mismatch.status).toBe(404);
  });

  it('never writes token material to its logs', async () => {
    const harness = track(makeHarness());
    const channel = await harness.server.mintSession({ kind: 'project', projectId: 'project-1' });
    await requestCredential(channel, 'protocol=https\nhost=github.com\n');
    await requestCredential(channel, 'protocol=https\nhost=evil.example\n');
    await requestCredential(channel, 'protocol=https\nhost=github.com\n', 'wrong');

    expect(harness.logLines.join('\n')).not.toContain(SECRET_TOKEN);
  });

  it('keeps an operation bound to its selected account through default changes and removal', async () => {
    const selected = { ...account, accountId: 'selected-work', isDefault: false };
    const inventory = [account, selected];
    const { server, readCredentials } = track(makeHarness({ accounts: inventory }));
    const channel = await server.mintSession({
      kind: 'account',
      host: 'github.com',
      accountId: selected.accountId,
    });
    expect((await requestCredential(channel, 'protocol=https\nhost=github.com\n')).status).toBe(
      200
    );
    expect(readCredentials).toHaveBeenLastCalledWith('selected-work', 'github.com');

    inventory[0] = { ...account, accountId: 'new-default' };
    expect((await requestCredential(channel, 'protocol=https\nhost=github.com\n')).status).toBe(
      200
    );
    expect(readCredentials).toHaveBeenLastCalledWith('selected-work', 'github.com');

    inventory.pop();
    readCredentials.mockClear();
    expect((await requestCredential(channel, 'protocol=https\nhost=github.com\n')).status).toBe(
      404
    );
    expect(readCredentials).not.toHaveBeenCalled();
  });
});
