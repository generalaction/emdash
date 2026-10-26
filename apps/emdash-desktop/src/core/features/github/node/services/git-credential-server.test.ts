import { err, ok } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadGitHubCredentials } from '@core/features/github/api/node/services/github-credentials';
import type { GitHubAccountSummary } from '@core/primitives/github/api';
import type { Resolved } from '@core/primitives/project-settings/api';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';
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
    resolution?: Resolved<ProviderAccountSummary | null>;
    accounts?: ProviderAccountSummary[];
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
  const readIntegrationCredentials = vi.fn(async () =>
    ok({ instanceUrl: 'https://gitlab.example.com', apiToken: SECRET_TOKEN })
  );
  const reportRejectedCredentials = vi.fn(async () => true);
  const server = new GitCredentialServer({
    resolveProjectIntegrationAccount: async () => ({
      ...(options.resolution ?? { value: account, provenance: { kind: 'set' as const } }),
      accounts: options.accounts ?? [account],
      contextKey: '',
    }),
    listAccounts: async () => options.accounts ?? [account],
    readCredentials,
    readIntegrationCredentials,
    reportRejectedCredentials,
    logger,
  });
  return {
    server,
    logLines,
    readCredentials,
    readIntegrationCredentials,
    reportRejectedCredentials,
  };
}

async function requestCredential(
  channel: { port: number; nonce: string },
  body: string,
  nonceOverride?: string,
  operation: 'get' | 'erase' = 'get'
): Promise<{ status: number; text: string }> {
  const response = await fetch(`http://127.0.0.1:${channel.port}/git-credential/${operation}`, {
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

  it('reports the current credential when git erases it after a rejection', async () => {
    const { server, reportRejectedCredentials, logLines } = track(makeHarness());
    const channel = await server.mintSession({ kind: 'project', projectId: 'project-1' });

    const result = await requestCredential(
      channel,
      `protocol=https\nhost=github.com\nusername=octocat\npassword=${SECRET_TOKEN}\n`,
      undefined,
      'erase'
    );

    expect(result).toEqual({ status: 200, text: '' });
    expect(reportRejectedCredentials).toHaveBeenCalledWith('github', 'account-1', {
      accessToken: SECRET_TOKEN,
      apiBaseUrl: 'https://api.github.com',
    });
    expect(logLines.join('\n')).not.toContain(SECRET_TOKEN);
  });

  it('ignores an erase of a credential it no longer serves', async () => {
    const { server, reportRejectedCredentials } = track(makeHarness());
    const channel = await server.mintSession({ kind: 'project', projectId: 'project-1' });

    const result = await requestCredential(
      channel,
      'protocol=https\nhost=github.com\nusername=octocat\npassword=ghp_previous\n',
      undefined,
      'erase'
    );

    expect(result).toEqual({ status: 200, text: '' });
    expect(reportRejectedCredentials).not.toHaveBeenCalled();
  });

  it('rejects erase requests with an unknown nonce', async () => {
    const { server, reportRejectedCredentials } = track(makeHarness());
    const channel = await server.mintSession({ kind: 'project', projectId: 'project-1' });

    const result = await requestCredential(
      channel,
      `protocol=https\nhost=github.com\npassword=${SECRET_TOKEN}\n`,
      'not-the-nonce',
      'erase'
    );

    expect(result.status).toBe(403);
    expect(reportRejectedCredentials).not.toHaveBeenCalled();
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

  describe('session channels', () => {
    const request = 'protocol=https\nhost=github.com\n';
    const project = { kind: 'project', projectId: 'project-1', providerId: 'github' } as const;

    it('hands a session the channel it already runs with', async () => {
      const { server } = track(makeHarness());
      const first = await server.channelForSession('p:t:terminal-1', project);

      const again = await server.channelForSession('p:t:terminal-1', project);
      const other = await server.channelForSession('p:t:terminal-2', project);

      expect(again).toEqual(first);
      expect(other.nonce).not.toBe(first.nonce);
      expect((await requestCredential(first, request)).status).toBe(200);
    });

    it('mints a new channel once the session has released its own', async () => {
      const { server } = track(makeHarness());
      const first = await server.channelForSession('p:t:terminal-1', project);

      server.revokeSession(first.nonce);
      const next = await server.channelForSession('p:t:terminal-1', project);

      expect(next.nonce).not.toBe(first.nonce);
      expect((await requestCredential(first, request)).status).toBe(403);
      expect((await requestCredential(next, request)).status).toBe(200);
    });

    it('mints a new channel for a changed target and keeps the old one for its live holder', async () => {
      const { server } = track(makeHarness());
      const github = await server.channelForSession('p:t:terminal-1', project);

      const gitlab = await server.channelForSession('p:t:terminal-1', {
        ...project,
        providerId: 'gitlab',
      });

      expect(gitlab.nonce).not.toBe(github.nonce);
      expect((await requestCredential(github, request)).status).toBe(200);
      // Releasing the replaced channel leaves the session's current one in place.
      server.revokeSession(github.nonce);
      expect(
        await server.channelForSession('p:t:terminal-1', { ...project, providerId: 'gitlab' })
      ).toEqual(gitlab);
    });

    it('never evicts a live channel, however many sessions come and go', async () => {
      const { server, logLines } = track(makeHarness());
      const longLived = await server.channelForSession('p:t:long-lived', project);

      for (let index = 0; index < 1_000; index += 1) {
        const channel = await server.channelForSession(`p:t:short-${index}`, project);
        server.revokeSession(channel.nonce);
      }
      const concurrent = [];
      for (let index = 0; index < 600; index += 1) {
        concurrent.push(await server.channelForSession(`p:t:live-${index}`, project));
      }

      expect((await requestCredential(longLived, request)).status).toBe(200);
      expect((await requestCredential(concurrent[0]!, request)).status).toBe(200);
      // Past the warning count the leak is logged once, never resolved by eviction.
      expect(logLines.filter((line) => line.includes('unusually many'))).toHaveLength(1);
    });
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

  it('answers a GitLab clone session only for its selected account and host', async () => {
    const gitlabAccount: ProviderAccountSummary = {
      providerId: 'gitlab',
      accountId: 'gitlab-1',
      displayName: '@user',
      host: 'gitlab.example.com',
      login: 'user',
      isDefault: true,
    };
    const { server, readIntegrationCredentials } = track(
      makeHarness({ accounts: [gitlabAccount] })
    );
    const channel = await server.mintSession({
      kind: 'account',
      providerId: 'gitlab',
      accountId: 'gitlab-1',
      host: 'gitlab.example.com',
    });
    const response = await requestCredential(channel, 'protocol=https\nhost=gitlab.example.com\n');
    expect(response).toEqual({ status: 200, text: `username=user\npassword=${SECRET_TOKEN}\n` });
    expect(readIntegrationCredentials).toHaveBeenCalledWith(
      'gitlab',
      'gitlab-1',
      'gitlab.example.com'
    );
    expect((await requestCredential(channel, 'protocol=https\nhost=evil.example\n')).status).toBe(
      404
    );
  });

  it('answers GitLab OAuth credentials with the oauth2 username', async () => {
    const gitlabAccount: ProviderAccountSummary = {
      providerId: 'gitlab',
      accountId: 'gitlab-1',
      displayName: '@user',
      host: 'gitlab.example.com',
      login: 'user',
      isDefault: true,
    };
    const harness = track(makeHarness({ accounts: [gitlabAccount] }));
    harness.readIntegrationCredentials.mockResolvedValueOnce(
      ok({
        instanceUrl: 'https://gitlab.example.com',
        accessToken: SECRET_TOKEN,
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3_600_000,
      }) as never
    );
    const channel = await harness.server.mintSession({
      kind: 'account',
      providerId: 'gitlab',
      accountId: 'gitlab-1',
      host: 'gitlab.example.com',
    });
    expect(await requestCredential(channel, 'protocol=https\nhost=gitlab.example.com\n')).toEqual({
      status: 200,
      text: `username=oauth2\npassword=${SECRET_TOKEN}\n`,
    });
  });

  it('refuses GitLab OAuth credentials issued for a different host', async () => {
    const gitlabAccount: ProviderAccountSummary = {
      providerId: 'gitlab',
      accountId: 'gitlab-1',
      displayName: '@user',
      host: 'gitlab.example.com',
      login: 'user',
      isDefault: true,
    };
    const harness = track(makeHarness({ accounts: [gitlabAccount] }));
    harness.readIntegrationCredentials.mockResolvedValueOnce(
      ok({
        instanceUrl: 'https://gitlab.com',
        accessToken: SECRET_TOKEN,
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3_600_000,
      }) as never
    );
    const channel = await harness.server.mintSession({
      kind: 'account',
      providerId: 'gitlab',
      accountId: 'gitlab-1',
      host: 'gitlab.example.com',
    });
    expect(
      (await requestCredential(channel, 'protocol=https\nhost=gitlab.example.com\n')).status
    ).toBe(404);
  });

  it('answers a GitLab project session with its current account', async () => {
    const gitlabAccount: ProviderAccountSummary = {
      providerId: 'gitlab',
      accountId: 'gitlab-1',
      displayName: '@user',
      host: 'gitlab.example.com',
      login: 'user',
      isDefault: true,
    };
    const { server, readIntegrationCredentials } = track(
      makeHarness({
        accounts: [gitlabAccount],
        resolution: { value: gitlabAccount, provenance: { kind: 'set' } },
      })
    );
    const channel = await server.mintSession({
      kind: 'project',
      projectId: 'project-1',
      providerId: 'gitlab',
    });
    const response = await requestCredential(channel, 'protocol=https\nhost=gitlab.example.com\n');
    expect(response.status).toBe(200);
    expect(readIntegrationCredentials).toHaveBeenCalledWith(
      'gitlab',
      'gitlab-1',
      'gitlab.example.com'
    );
  });

  it('rejects a GitLab token when its instance URL differs from the clone host', async () => {
    const gitlabAccount: ProviderAccountSummary = {
      providerId: 'gitlab',
      accountId: 'gitlab-1',
      displayName: '@user',
      host: 'other.example.com',
      login: 'user',
      isDefault: true,
    };
    const { server } = track(makeHarness({ accounts: [gitlabAccount] }));
    const channel = await server.mintSession({
      kind: 'account',
      providerId: 'gitlab',
      accountId: 'gitlab-1',
      host: 'other.example.com',
    });
    expect(
      (await requestCredential(channel, 'protocol=https\nhost=other.example.com\n')).status
    ).toBe(404);
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
