import type { IssuesPluginProvider } from '@emdash/plugins/issues';
import { ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListAccounts,
  mockGetDefaultAccountId,
  mockResolveToken,
  mockResolve,
  mockAuthContext,
} = vi.hoisted(() => ({
  mockListAccounts: vi.fn(),
  mockGetDefaultAccountId: vi.fn(),
  mockResolveToken: vi.fn(),
  mockResolve: vi.fn(),
  mockAuthContext: vi.fn(),
}));

vi.mock('@main/core/github/accounts/github-account-registry-instance', () => ({
  githubAccountRegistry: {
    listAccounts: mockListAccounts,
    getDefaultAccountId: mockGetDefaultAccountId,
    resolveToken: mockResolveToken,
  },
}));

vi.mock('@main/core/github/services/github-repository-resolver', () => ({
  githubRepositoryResolver: { resolve: mockResolve },
}));

vi.mock('@main/core/github/services/project-github-auth-context', () => ({
  resolveProjectGitHubAuthContext: mockAuthContext,
}));

vi.mock('@main/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { createGitHubPluginIssueProvider } from './github-plugin-issue-provider';

const repository = {
  host: 'github.com',
  owner: 'acme',
  repo: 'widgets',
  nameWithOwner: 'acme/widgets',
  repositoryUrl: 'https://github.com/acme/widgets',
};

type IssueRows = { identifier: string; title: string; url: string }[];

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
    const provider = createGitHubPluginIssueProvider(plugin);

    const result = await provider.listIssues({ repositoryUrl: repository.repositoryUrl });
    expect(result).toMatchObject({ success: false, errorType: 'auth_required' });
  });

  it('reports a missing account by id', async () => {
    mockListAccounts.mockResolvedValue([]);
    mockGetDefaultAccountId.mockResolvedValue('github.com:42');
    const { plugin } = makePlugin();
    const provider = createGitHubPluginIssueProvider(plugin);

    const result = await provider.listIssues({ repositoryUrl: repository.repositoryUrl });
    expect(result).toMatchObject({
      success: false,
      errorType: 'account_not_found',
      accountId: 'github.com:42',
    });
  });

  it('rejects accounts whose host does not match the repository', async () => {
    mockListAccounts.mockResolvedValue([
      { id: 'ghe.example.com:7', login: 'octocat', host: 'ghe.example.com' },
    ]);
    mockGetDefaultAccountId.mockResolvedValue('ghe.example.com:7');
    const { plugin } = makePlugin();
    const provider = createGitHubPluginIssueProvider(plugin);

    const result = await provider.listIssues({ repositoryUrl: repository.repositoryUrl });
    expect(result).toMatchObject({
      success: false,
      errorType: 'account_host_mismatch',
      accountHost: 'ghe.example.com',
      host: 'github.com',
    });
  });

  it('reports a missing token for a known account', async () => {
    mockListAccounts.mockResolvedValue([
      { id: 'github.com:42', login: 'octocat', host: 'github.com' },
    ]);
    mockGetDefaultAccountId.mockResolvedValue('github.com:42');
    mockResolveToken.mockResolvedValue(null);
    const { plugin } = makePlugin();
    const provider = createGitHubPluginIssueProvider(plugin);

    const result = await provider.listIssues({ repositoryUrl: repository.repositoryUrl });
    expect(result).toMatchObject({ success: false, errorType: 'token_missing' });
  });

  it('invokes the plugin with the resolved token and api base url', async () => {
    mockListAccounts.mockResolvedValue([
      { id: 'github.com:42', login: 'octocat', host: 'github.com' },
    ]);
    mockGetDefaultAccountId.mockResolvedValue('github.com:42');
    mockResolveToken.mockResolvedValue('gho_token');
    const { plugin, listIssues } = makePlugin(
      vi.fn(async () => ok([{ identifier: '#1', title: 'Bug', url: 'https://x' }]))
    );
    const provider = createGitHubPluginIssueProvider(plugin);

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
    const provider = createGitHubPluginIssueProvider(plugin);

    const result = await provider.listIssues({ repositoryUrl: 'https://gitlab.com/a/b' });
    expect(result).toMatchObject({
      success: false,
      errorType: 'unsupported_host',
      host: 'gitlab.com',
    });
  });
});
