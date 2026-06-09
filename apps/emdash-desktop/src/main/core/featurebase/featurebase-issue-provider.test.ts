import { beforeEach, describe, expect, it, vi } from 'vitest';
import { featurebaseConnectionService } from './featurebase-connection-service';
import { featurebaseIssueProvider } from './featurebase-issue-provider';

vi.mock('./featurebase-connection-service', () => ({
  NOT_CONFIGURED_ERROR: 'Featurebase is not configured. Connect Featurebase in settings.',
  featurebaseConnectionService: {
    getClient: vi.fn(),
    checkConnection: vi.fn(),
  },
  toFeaturebaseErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));

const mockGetClient = vi.mocked(featurebaseConnectionService.getClient);

function makeFeaturebaseClient(get: ReturnType<typeof vi.fn>) {
  return { get };
}

describe('featurebaseIssueProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps Featurebase posts to Emdash issues', async () => {
    const get = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'post-1',
          slug: 'add-dark-mode-support',
          postUrl: 'https://feedback.example.com/p/add-dark-mode-support',
          title: 'Add dark mode support',
          content: '<p>It would be great to have dark mode.</p>',
          status: { name: 'In Progress', type: 'active' },
          tags: [{ name: 'feature' }, { name: 'ui' }],
          updatedAt: '2026-04-17T12:00:00.000Z',
        },
      ],
    });
    mockGetClient.mockResolvedValue(makeFeaturebaseClient(get) as never);

    const result = await featurebaseIssueProvider.listIssues({ limit: 10 });

    expect(get).toHaveBeenCalledWith('/v2/posts', {
      limit: 10,
      sortBy: 'recent',
      sortOrder: 'desc',
      q: undefined,
    });
    expect(result).toEqual({
      success: true,
      issues: [
        expect.objectContaining({
          provider: 'featurebase',
          identifier: 'add-dark-mode-support',
          title: 'Add dark mode support',
          url: 'https://feedback.example.com/p/add-dark-mode-support',
          description: 'It would be great to have dark mode.',
          status: 'In Progress',
          project: 'feature, ui',
          updatedAt: '2026-04-17T12:00:00.000Z',
        }),
      ],
    });
  });

  it('uses q when searching Featurebase posts', async () => {
    const get = vi.fn().mockResolvedValue({ data: [] });
    mockGetClient.mockResolvedValue(makeFeaturebaseClient(get) as never);

    const result = await featurebaseIssueProvider.searchIssues({
      searchTerm: ' dark mode ',
      limit: 5,
    });

    expect(get).toHaveBeenCalledWith('/v2/posts', {
      limit: 5,
      sortBy: 'recent',
      sortOrder: 'desc',
      q: 'dark mode',
    });
    expect(result).toEqual({ success: true, issues: [] });
  });

  it('does not search Featurebase for an empty term', async () => {
    const get = vi.fn();
    mockGetClient.mockResolvedValue(makeFeaturebaseClient(get) as never);

    const result = await featurebaseIssueProvider.searchIssues({
      searchTerm: '   ',
      limit: 5,
    });

    expect(get).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, issues: [] });
  });

  it('returns a configuration error when Featurebase is not connected', async () => {
    mockGetClient.mockResolvedValue(null);

    const result = await featurebaseIssueProvider.listIssues({ limit: 10 });

    expect(result).toEqual({
      success: false,
      error: 'Featurebase is not configured. Connect Featurebase in settings.',
    });
  });
});
