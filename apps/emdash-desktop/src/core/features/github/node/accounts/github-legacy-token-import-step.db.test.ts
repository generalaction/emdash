import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubTokenSource, GitHubUser } from '@core/primitives/github/api';
import { LegacyAccountImports } from '@core/services/provider-accounts/node/migrations/legacy-account-imports';
import { LegacyGitHubTokenMigrationStore } from '../services/legacy-github-token-migration-store';
import { GITHUB_PROVIDER_ID, connectGitHubAccount } from './github-auth-connection';
import { GitHubLegacyTokenImportStep } from './github-legacy-token-import-step';

const FLAG_KEY = 'github-legacy-token-import:completedAt';

class LegacyGitHubConnection {
  token: string | null = 'gho_monalisa';
  source: Exclude<GitHubTokenSource, null> | null = 'secure_storage';
  getStoredTokenRecord = vi.fn(async () =>
    this.token === null ? null : { token: this.token, source: this.source }
  );
  clearStoredToken = vi.fn(async () => {
    this.token = null;
  });
}

class GitHubIdentityClient {
  user: GitHubUser | null = {
    id: 42,
    login: 'monalisa',
    name: 'Mona Lisa',
    email: 'mona@example.com',
    avatar_url: 'https://avatars.githubusercontent.com/u/42',
  };

  getAuthenticatedUser = vi.fn(async () => this.user);
}

describe('GitHubLegacyTokenImportStep', () => {
  let fixture: RegistryFixture;
  let legacyConnection: LegacyGitHubConnection;
  let identityClient: GitHubIdentityClient;
  let step: GitHubLegacyTokenImportStep;

  beforeEach(async () => {
    fixture = await openRegistryFixture('empty');
    legacyConnection = new LegacyGitHubConnection();
    identityClient = new GitHubIdentityClient();
    step = new GitHubLegacyTokenImportStep(
      new LegacyAccountImports(fixture.db, fixture.secretStore, { warn: vi.fn() }),
      legacyConnection,
      identityClient
    );
  });

  afterEach(() => {
    fixture?.close();
  });

  function storedFlag(): string | undefined {
    const row = fixture.sqlite.prepare(`SELECT value FROM kv WHERE key = ?`).get(FLAG_KEY) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  it('retries cleanup after restart without recreating an account the user removed', async () => {
    legacyConnection.clearStoredToken.mockRejectedValueOnce(new Error('keychain unavailable'));
    expect(await step.run()).toBe('retry');
    expect(await fixture.registry.listAccounts('github')).toHaveLength(1);
    await fixture.registry.removeAccount('github', 'github.com:42');

    const restarted = new GitHubLegacyTokenImportStep(
      new LegacyAccountImports(fixture.db, fixture.secretStore, { warn: vi.fn() }),
      legacyConnection,
      identityClient
    );
    await restarted.run();
    expect(await fixture.registry.listAccounts('github')).toEqual([]);
    expect(legacyConnection.token).toBeNull();
    expect(identityClient.getAuthenticatedUser).toHaveBeenCalledTimes(1);
  });

  it('honors historical completion timestamps without importing a lingering token', async () => {
    fixture.sqlite
      .prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, 0)')
      .run(FLAG_KEY, '1234');
    expect(await step.run()).toBe('complete');
    expect(legacyConnection.getStoredTokenRecord).not.toHaveBeenCalled();
    expect(await fixture.registry.listAccounts('github')).toEqual([]);
  });

  it('fails closed when the completion marker is malformed', async () => {
    fixture.sqlite
      .prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, 0)')
      .run(FLAG_KEY, 'broken');
    await expect(step.run()).rejects.toThrow();
    expect(legacyConnection.getStoredTokenRecord).not.toHaveBeenCalled();
  });

  it('does not commit an imported account if its completion marker cannot be written', async () => {
    fixture.sqlite.exec(
      "CREATE TRIGGER block_import_marker BEFORE INSERT ON kv WHEN NEW.key = 'github-legacy-token-import:completedAt' BEGIN SELECT RAISE(FAIL, 'marker blocked'); END"
    );
    await expect(step.run()).rejects.toThrow('marker blocked');
    expect(await fixture.registry.listAccounts('github')).toEqual([]);
    expect(legacyConnection.token).not.toBeNull();
    fixture.sqlite.exec('DROP TRIGGER block_import_marker');
    expect(await step.run()).toBe('complete');
    expect(await fixture.registry.listAccounts('github')).toHaveLength(1);
  });

  it('serializes concurrent migration calls while identity lookup is pending', async () => {
    await Promise.all([step.run(), step.run(), step.run()]);
    expect(identityClient.getAuthenticatedUser).toHaveBeenCalledTimes(1);
    expect(legacyConnection.clearStoredToken).toHaveBeenCalledTimes(1);
  });

  it('retries real metadata cleanup failures without reimporting after removal', async () => {
    fixture.secretStore.secrets.set('emdash-github-token', 'legacy-token');
    fixture.sqlite
      .prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, 0)')
      .run('github:tokenSource', '"cli"');
    fixture.sqlite.exec(
      "CREATE TRIGGER block_github_cleanup BEFORE DELETE ON kv WHEN OLD.key = 'github:tokenSource' BEGIN SELECT RAISE(FAIL, 'cleanup blocked'); END"
    );
    const makeStep = () =>
      new GitHubLegacyTokenImportStep(
        new LegacyAccountImports(fixture.db, fixture.secretStore, { warn: vi.fn() }),
        new LegacyGitHubTokenMigrationStore(fixture.db, fixture.secretStore),
        identityClient
      );
    expect(await makeStep().run()).toBe('retry');
    await fixture.registry.removeAccount('github', 'github.com:42');
    fixture.sqlite.exec('DROP TRIGGER block_github_cleanup');
    expect(await makeStep().run()).toBe('complete');
    expect(await fixture.registry.listAccounts('github')).toEqual([]);
    expect(
      fixture.sqlite.prepare('SELECT value FROM kv WHERE key = ?').get('github:tokenSource')
    ).toBeUndefined();
    expect(identityClient.getAuthenticatedUser).toHaveBeenCalledTimes(1);
  });

  it('imports the legacy token into an account, clears it, and sets the done-flag', async () => {
    const result = await step.run();

    expect(result).toBe('complete');
    await expect(fixture.registry.resolveSecret(GITHUB_PROVIDER_ID, 'github.com:42')).resolves.toBe(
      JSON.stringify({ accessToken: 'gho_monalisa', apiBaseUrl: 'https://api.github.com' })
    );
    await expect(fixture.registry.getDefaultAccountId(GITHUB_PROVIDER_ID)).resolves.toBe(
      'github.com:42'
    );
    expect(legacyConnection.clearStoredToken).toHaveBeenCalled();
    expect(storedFlag()).toBeDefined();
  });

  it('never probes secret storage again once the flag is set', async () => {
    await expect(step.run()).resolves.toBe('complete');

    legacyConnection.getStoredTokenRecord.mockClear();
    await expect(step.run()).resolves.toBe('complete');
    expect(legacyConnection.getStoredTokenRecord).not.toHaveBeenCalled();
  });

  it('completes immediately on a fresh install with no legacy token', async () => {
    legacyConnection.token = null;

    await expect(step.run()).resolves.toBe('complete');
    expect(identityClient.getAuthenticatedUser).not.toHaveBeenCalled();
    await expect(fixture.registry.listAccounts(GITHUB_PROVIDER_ID)).resolves.toEqual([]);
    expect(storedFlag()).toBeDefined();

    await expect(step.run()).resolves.toBe('complete');
  });

  it('leaves the flag unset when the identity lookup fails, so the next launch retries', async () => {
    identityClient.user = null;

    await expect(step.run()).resolves.toBe('retry');
    expect(legacyConnection.clearStoredToken).not.toHaveBeenCalled();
    await expect(fixture.registry.listAccounts(GITHUB_PROVIDER_ID)).resolves.toEqual([]);
    expect(storedFlag()).toBeUndefined();

    identityClient.user = {
      id: 42,
      login: 'monalisa',
      name: 'Mona Lisa',
      email: 'mona@example.com',
      avatar_url: 'https://avatars.githubusercontent.com/u/42',
    };
    await expect(step.run()).resolves.toBe('complete');
    expect(storedFlag()).toBeDefined();
  });

  it('does not replace an existing default account', async () => {
    const { account: existing } = await connectGitHubAccount(fixture.connections, {
      accessToken: 'gho_octocat',
      credentialSource: 'emdash_oauth',
      providerAccount: {
        providerId: 'github',
        providerAccountId: '84',
        host: 'github.com',
        login: 'octocat',
        avatarUrl: '',
      },
    });

    await expect(step.run()).resolves.toBe('complete');
    await expect(fixture.registry.getDefaultAccountId(GITHUB_PROVIDER_ID)).resolves.toBe(
      existing.accountId
    );
  });

  it('uses CLI as the credential source when the legacy token came from GitHub CLI', async () => {
    legacyConnection.source = 'cli';

    await expect(step.run()).resolves.toBe('complete');
    expect(
      (await fixture.registry.getAccount('github', 'github.com:42'))?.meta?.credentialSource
    ).toBe('cli');
  });
});
