import { noopLogger } from '@emdash/shared/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as featurebaseClient from '../../../integrations/impl/featurebase/client';
import {
  FeaturebaseHttpError,
  getFeaturebaseClient,
  type FeaturebaseClient,
} from '../../../integrations/impl/featurebase/client';
import { provider } from './index';

vi.mock('../../../integrations/impl/featurebase/client', async (importOriginal) => {
  const actual = await importOriginal<typeof featurebaseClient>();
  return { ...actual, getFeaturebaseClient: vi.fn() };
});

const issues = provider.behavior.issues;
if (!issues) throw new Error('Featurebase issues plugin has no issues behavior');

const mockGetClient = vi.mocked(getFeaturebaseClient);
const host = { log: noopLogger, credentials: {} };

function mockClient(get: ReturnType<typeof vi.fn>) {
  mockGetClient.mockReturnValue({ get } as unknown as FeaturebaseClient);
  return get;
}

describe('featurebase issues plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps Featurebase posts to Emdash issues', async () => {
    const get = mockClient(
      vi.fn().mockResolvedValue({
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
      })
    );

    const result = await issues.listIssues(host, { limit: 10 });

    expect(get).toHaveBeenCalledWith('/v2/posts', {
      limit: 10,
      sortBy: 'recent',
      sortOrder: 'desc',
      q: undefined,
    });
    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
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
    const get = mockClient(vi.fn().mockResolvedValue({ data: [] }));

    const result = await issues.searchIssues(host, { searchTerm: ' dark mode ', limit: 5 });

    expect(get).toHaveBeenCalledWith('/v2/posts', {
      limit: 5,
      sortBy: 'recent',
      sortOrder: 'desc',
      q: 'dark mode',
    });
    expect(result).toEqual({ success: true, data: [] });
  });

  it('does not search Featurebase for an empty term', async () => {
    const get = mockClient(vi.fn());

    const result = await issues.searchIssues(host, { searchTerm: '   ', limit: 5 });

    expect(get).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: [] });
  });

  it('maps Featurebase HTTP failures to a typed issue error', async () => {
    mockClient(vi.fn().mockRejectedValue(new FeaturebaseHttpError(401, 'Invalid API key')));

    const result = await issues.listIssues(host, { limit: 10 });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'generic',
        message: 'Featurebase authentication failed. Check your API key.',
      },
    });
  });
});
