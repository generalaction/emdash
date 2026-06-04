import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import type { ProjectSettings } from '@shared/project-settings';
import {
  GitHubAccountSelectionResolver,
  type GitHubAccountLookup,
} from './github-account-selection-resolver';

vi.mock('./github-account-registry-instance', () => ({
  githubAccountRegistry: {
    listAccounts: vi.fn(),
  },
}));

function makeSettings(settings: ProjectSettings): Pick<ProjectSettingsProvider, 'get'> {
  return {
    get: vi.fn().mockResolvedValue(settings),
  };
}

function makeCtx(config: Record<string, string | undefined>): Pick<IExecutionContext, 'exec'> {
  return {
    exec: vi.fn().mockImplementation(async (_command: string, args?: string[]) => {
      const key = args?.[2];
      const value = key ? config[key] : undefined;
      if (value === undefined) throw new Error('config not found');
      return { stdout: `${value}\n`, stderr: '' };
    }),
  };
}

function makeLookup(): GitHubAccountLookup {
  return {
    listAccounts: vi.fn().mockResolvedValue([
      {
        id: 'github.com:42',
        providerAccountId: '42',
        host: 'github.com',
        login: 'monalisa',
        avatarUrl: '',
        credentialSource: 'emdash_oauth',
        connectedAt: 1,
        updatedAt: 1,
      },
    ]),
  };
}

describe('GitHubAccountSelectionResolver', () => {
  let lookup: GitHubAccountLookup;
  let resolver: GitHubAccountSelectionResolver;

  beforeEach(() => {
    lookup = makeLookup();
    resolver = new GitHubAccountSelectionResolver(lookup);
  });

  it('uses project settings when a GitHub account id is configured', async () => {
    const settings = makeSettings({ githubAccountId: 'github.com:42' });
    const ctx = makeCtx({ 'emdash.ghaccount': 'other' });

    await expect(resolver.resolve({ settings, ctx })).resolves.toEqual({
      accountId: 'github.com:42',
      source: 'project-settings',
    });
    expect(ctx.exec).not.toHaveBeenCalled();
    expect(lookup.listAccounts).not.toHaveBeenCalled();
  });

  it('treats null project settings as an explicit no-account override', async () => {
    const settings = makeSettings({ githubAccountId: null });
    const ctx = makeCtx({ 'emdash.ghaccount': 'monalisa' });

    await expect(resolver.resolve({ settings, ctx })).resolves.toEqual({
      accountId: null,
      source: 'project-settings',
    });
    expect(ctx.exec).not.toHaveBeenCalled();
  });

  it('uses an account id from git config when project settings are absent', async () => {
    const settings = makeSettings({});
    const ctx = makeCtx({ 'emdash.githubAccountId': 'github.com:42' });

    await expect(resolver.resolve({ settings, ctx })).resolves.toEqual({
      accountId: 'github.com:42',
      source: 'git-config',
    });
    expect(lookup.listAccounts).toHaveBeenCalled();
  });

  it('maps an emdash.ghaccount login from git config to a connected account id', async () => {
    const settings = makeSettings({});
    const ctx = makeCtx({ 'emdash.ghaccount': 'Monalisa' });

    await expect(resolver.resolve({ settings, ctx })).resolves.toEqual({
      accountId: 'github.com:42',
      source: 'git-config',
    });
  });

  it('keeps an unknown git config value explicit instead of falling back', async () => {
    const settings = makeSettings({});
    const ctx = makeCtx({ 'emdash.ghaccount': 'unknown-account' });

    await expect(resolver.resolve({ settings, ctx })).resolves.toEqual({
      accountId: 'unknown-account',
      source: 'git-config',
    });
  });

  it('returns no account selection when project settings and git config are absent', async () => {
    const settings = makeSettings({});
    const ctx = makeCtx({});

    await expect(resolver.resolve({ settings, ctx })).resolves.toEqual({
      accountId: null,
      source: 'none',
    });
    expect(lookup.listAccounts).not.toHaveBeenCalled();
  });
});
