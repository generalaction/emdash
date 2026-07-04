import type { IssuesPluginProvider } from '@emdash/plugins/issues';
import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCredentials, mockCheckConnection } = vi.hoisted(() => ({
  mockGetCredentials: vi.fn(),
  mockCheckConnection: vi.fn(),
}));

vi.mock('./integration-credential-store-instance', () => ({
  integrationCredentialStore: {
    get: mockGetCredentials,
    isConfigured: vi.fn(async () => true),
  },
}));

vi.mock('./integration-connection-service', () => ({
  integrationConnectionService: { checkConnection: mockCheckConnection },
}));

vi.mock('@main/lib/logger', () => {
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

import { mapPluginIssueError } from '../issues/plugin-issue-adapter';
import { createPluginIssueProvider } from './plugin-issue-provider';

function makePlugin(overrides: {
  requiredInputs?: 'repositoryUrl'[];
  listIssues?: ReturnType<typeof vi.fn>;
  searchIssues?: ReturnType<typeof vi.fn>;
  getIssue?: ReturnType<typeof vi.fn>;
}): IssuesPluginProvider {
  return {
    metadata: { integrationId: 'linear' },
    capabilities: { issues: { requiredInputs: overrides.requiredInputs ?? [] } },
    assets: {},
    validate: () => [],
    behavior: {
      issues: {
        listIssues: overrides.listIssues ?? vi.fn(async () => ok([])),
        searchIssues: overrides.searchIssues ?? vi.fn(async () => ok([])),
        ...(overrides.getIssue ? { getIssue: overrides.getIssue } : {}),
      },
    },
  } as unknown as IssuesPluginProvider;
}

describe('mapPluginIssueError', () => {
  it('maps auth_failed to auth_required', () => {
    expect(mapPluginIssueError({ type: 'auth_failed', message: 'bad token' })).toEqual({
      success: false,
      error: 'bad token',
      errorType: 'auth_required',
    });
  });

  it('maps invalid_input to generic', () => {
    expect(mapPluginIssueError({ type: 'invalid_input', message: 'nope' })).toEqual({
      success: false,
      error: 'nope',
      errorType: 'generic',
    });
  });

  it('passes through rate limit metadata', () => {
    expect(
      mapPluginIssueError({ type: 'rate_limited', message: 'slow down', resetAt: '2026-01-01' })
    ).toEqual({
      success: false,
      error: 'slow down',
      errorType: 'rate_limited',
      resetAt: '2026-01-01',
    });
  });

  it('passes through sso metadata', () => {
    expect(
      mapPluginIssueError({ type: 'sso_required', message: 'sso', ssoUrl: 'https://sso' })
    ).toEqual({
      success: false,
      error: 'sso',
      errorType: 'sso_required',
      ssoUrl: 'https://sso',
    });
  });
});

describe('createPluginIssueProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives capabilities from requiredInputs', () => {
    const provider = createPluginIssueProvider(makePlugin({ requiredInputs: ['repositoryUrl'] }));
    expect(provider.capabilities).toEqual({
      requiresRepositoryUrl: true,
      supportsIssueContext: false,
    });
  });

  it('returns auth_required when the integration is not connected', async () => {
    mockGetCredentials.mockResolvedValue(null);
    const provider = createPluginIssueProvider(makePlugin({}));

    await expect(provider.listIssues({})).resolves.toEqual({
      success: false,
      error: 'linear is not connected.',
      errorType: 'auth_required',
    });
  });

  it('gates repository-scoped plugins on a repository URL', async () => {
    mockGetCredentials.mockResolvedValue({ apiToken: 't' });
    const listIssues = vi.fn(async () => ok([]));
    const provider = createPluginIssueProvider(
      makePlugin({ requiredInputs: ['repositoryUrl'], listIssues })
    );

    await expect(provider.listIssues({})).resolves.toEqual({
      success: false,
      error: 'Repository URL is required.',
      errorType: 'generic',
    });
    expect(listIssues).not.toHaveBeenCalled();
  });

  it('invokes the plugin with host credentials and maps issues', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'k' });
    const listIssues = vi.fn(async () =>
      ok([{ identifier: 'ENG-1', title: 'Fix it', url: 'https://linear.app/eng-1' }])
    );
    const provider = createPluginIssueProvider(makePlugin({ listIssues }));

    const result = await provider.listIssues({ limit: 10 });
    expect(listIssues).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { apiKey: 'k' } }),
      expect.objectContaining({ limit: 10 })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.issues[0]).toMatchObject({
        provider: 'linear',
        identifier: 'ENG-1',
        title: 'Fix it',
      });
    }
  });

  it('maps plugin errors on search', async () => {
    mockGetCredentials.mockResolvedValue({ apiKey: 'k' });
    const searchIssues = vi.fn(async () => err({ type: 'auth_failed' as const, message: '401' }));
    const provider = createPluginIssueProvider(makePlugin({ searchIssues }));

    await expect(provider.searchIssues({ searchTerm: 'bug' })).resolves.toEqual({
      success: false,
      error: '401',
      errorType: 'auth_required',
    });
  });

  it('short-circuits empty search terms', async () => {
    const searchIssues = vi.fn();
    const provider = createPluginIssueProvider(makePlugin({ searchIssues }));

    await expect(provider.searchIssues({ searchTerm: '   ' })).resolves.toEqual({
      success: true,
      issues: [],
    });
    expect(searchIssues).not.toHaveBeenCalled();
    expect(mockGetCredentials).not.toHaveBeenCalled();
  });

  it('exposes getIssueContext only when the plugin implements getIssue', async () => {
    const withoutGet = createPluginIssueProvider(makePlugin({}));
    expect(withoutGet.getIssueContext).toBeUndefined();

    mockGetCredentials.mockResolvedValue({ apiKey: 'k' });
    const getIssue = vi.fn(async () =>
      ok({ identifier: 'ENG-1', title: 'Fix it', url: 'https://linear.app/eng-1' })
    );
    const withGet = createPluginIssueProvider(makePlugin({ getIssue }));
    const result = await withGet.getIssueContext?.({ identifier: 'ENG-1' });
    expect(result).toMatchObject({ success: true });
  });
});
