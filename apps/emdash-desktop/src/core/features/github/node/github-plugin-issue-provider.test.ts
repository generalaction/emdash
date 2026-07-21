import type { IssuesPluginProvider } from '@emdash/plugins/issues';
import { ok } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListAccounts,
  mockGetDefaultAccountId,
  mockResolveSecret,
  mockResolve,
  mockAuthContext,
} = vi.hoisted(() => ({
  mockListAccounts: vi.fn(),
  mockGetDefaultAccountId: vi.fn(),
  mockResolveSecret: vi.fn(),
  mockResolve: vi.fn(),
  mockAuthContext: vi.fn(),
}));

vi.mock('@core/features/github/api/node/services/github-repository-resolver', () => ({
  githubRepositoryResolver: { resolve: mockResolve },
}));

vi.mock('@emdash/shared/logger', () => {
  const log = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  log.child.mockReturnValue(log);
  return { log };
});

import { createGitHubPluginIssueProvider } from '@core/features/github/api/node/github-plugin-issue-provider';
import { GitHubApiAuthService } from '@core/features/github/api/node/services/github-api-auth-service';

const accounts = {
  listAccounts: mockListAccounts,
  getDefaultAccountId: mockGetDefaultAccountId,
  resolveSecret: mockResolveSecret,
};
const dependencies = {
  accounts,
  auth: new GitHubApiAuthService(accounts as never),
  logger: log,
  resolveProjectAuthContext: mockAuthContext,
};

const repository = {
  host: 'github.com',
  owner: 'acme',
  repo: 'widgets',
  nameWithOwner: 'acme/widgets',
  repositoryUrl: 'https://github.com/acme/widgets',
};

type IssueRows = { identifier: string; title: string; url: string }[];

function providerAccountRow(accountId: string, host: string, login: string) {
  return {
    providerId: 'github',
    accountId,
    credentialRef: `provider-credential:github:${accountId}`,
    isDefault: true,
    meta: {
      version: '1',
      host,
      login,
      providerAccountId: accountId.split(':').pop() ?? accountId,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

function makePlugin(listIssues = vi.fn(async () => ok([] as IssueRows))): {
  plugin: IssuesPluginProvider;
  listIssues: ReturnType<typeof vi.fn>;
} {
  const plugin = {
    metadata: { integrationId: 'github' },
    capabilities: { issues: { requiredInputs: ['repositoryUrl'] } },
    assets: {},
    validate: () => [],
    behavior: {
      issues: {
        listIssues,
        searchIssues: vi.fn(async () => ok([])),
      },
    },
  } as unknown as IssuesPluginProvider;
  return { plugin, listIssues };
}

describe('createGitHubPluginIssueProvider account resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockResolvedValue({ success: true, data: repository });
    mockAuthContext.mockResolvedValue({ success: true, data: undefined });
  });

  it('requires a connected account', async () => {
    mockListAccounts.mockResolvedValue([]);
    mockGetDefaultAccountId.mockResolvedValue(null);
    const { plugin } = makePlugin();
    const provider = createGitHubPluginIssueProvider(plugin, dependencies);

    const result = await provider.listIssues({ repositoryUrl: repository.repositoryUrl });
    expect(result).toMatchObject({ success: false, error: { type: 'auth_required' } });
  });

  it('reports a missing pinned account by id', async () => {
    mockListAccounts.mockResolvedValue([]);
    mockAuthContext.mockResolvedValue({ success: true, data: { accountId: 'github.com:42' } });
    const { plugin } = makePlugin();
    const provider = createGitHubPluginIssueProvider(plugin, dependencies);

    const result = await provider.listIssues({
      projectId: 'project-1',
      repositoryUrl: repository.repositoryUrl,
    });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'account_not_found', accountId: 'github.com:42' },
    });
  });

  it('rejects pinned accounts whose host does not match the repository', async () => {
    mockListAccounts.mockResolvedValue([
      providerAccountRow('ghe.example.com:7', 'ghe.example.com', 'octocat'),
    ]);
    mockAuthContext.mockResolvedValue({ success: true, data: { accountId: 'ghe.example.com:7' } });
    const { plugin } = makePlugin();
    const provider = createGitHubPluginIssueProvider(plugin, dependencies);

    const result = await provider.listIssues({
      projectId: 'project-1',
      repositoryUrl: repository.repositoryUrl,
    });
    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'account_host_mismatch',
        accountHost: 'ghe.example.com',
        host: 'github.com',
      },
    });
  });

  it('requires auth when the default account is for another host', async () => {
    mockListAccounts.mockResolvedValue([
      providerAccountRow('ghe.example.com:7', 'ghe.example.com', 'octocat'),
    ]);
    mockGetDefaultAccountId.mockResolvedValue('ghe.example.com:7');
    const { plugin } = makePlugin();
    const provider = createGitHubPluginIssueProvider(plugin, dependencies);

    const result = await provider.listIssues({ repositoryUrl: repository.repositoryUrl });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'auth_required', host: 'github.com' },
    });
  });

  it('reports a missing token for a known account', async () => {
    mockListAccounts.mockResolvedValue([
      providerAccountRow('github.com:42', 'github.com', 'octocat'),
    ]);
    mockGetDefaultAccountId.mockResolvedValue('github.com:42');
    mockResolveSecret.mockResolvedValue(null);
    const { plugin } = makePlugin();
    const provider = createGitHubPluginIssueProvider(plugin, dependencies);

    const result = await provider.listIssues({ repositoryUrl: repository.repositoryUrl });
    expect(result).toMatchObject({ success: false, error: { type: 'token_missing' } });
  });

  it('invokes the plugin with the resolved token and api base url', async () => {
    mockListAccounts.mockResolvedValue([
      providerAccountRow('github.com:42', 'github.com', 'octocat'),
    ]);
    mockGetDefaultAccountId.mockResolvedValue('github.com:42');
    mockResolveSecret.mockResolvedValue('gho_token');
    const { plugin, listIssues } = makePlugin(
      vi.fn(async () => ok([{ identifier: '#1', title: 'Bug', url: 'https://x' }]))
    );
    const provider = createGitHubPluginIssueProvider(plugin, dependencies);

    const result = await provider.listIssues({ repositoryUrl: repository.repositoryUrl });
    expect(listIssues).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { accessToken: 'gho_token', apiBaseUrl: 'https://api.github.com' },
      }),
      expect.objectContaining({ repositoryUrl: repository.repositoryUrl })
    );
    expect(result).toMatchObject({ success: true });
  });

  it('maps unsupported hosts from the repository resolver', async () => {
    mockResolve.mockResolvedValue({
      success: false,
      error: { type: 'not_github', host: 'gitlab.com' },
    });
    const { plugin } = makePlugin();
    const provider = createGitHubPluginIssueProvider(plugin, dependencies);

    const result = await provider.listIssues({ repositoryUrl: 'https://gitlab.com/a/b' });
    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'unsupported_host',
        message: expect.stringContaining('gitlab.com'),
      },
    });
  });
});
