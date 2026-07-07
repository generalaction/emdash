import { noopLogger } from '@emdash/shared/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as featurebaseClient from '../../../integrations/impl/featurebase/client';
import { createFeaturebaseClient } from '../../../integrations/impl/featurebase/client';
import type { FeaturebaseClient } from '../../../integrations/impl/featurebase/types';
import { provider } from './index';

vi.mock('../../../integrations/impl/featurebase/client', async (importOriginal) => {
  const actual = await importOriginal<typeof featurebaseClient>();
  return { ...actual, createFeaturebaseClient: vi.fn() };
});

const issues = provider.behavior.issues;
if (!issues) throw new Error('Featurebase issues plugin has no issues behavior');

const mockCreateClient = vi.mocked(createFeaturebaseClient);
const host = { log: noopLogger, credentials: { apiKey: 'fb-token' } };

function mockClient(list: ReturnType<typeof vi.fn>) {
  const client: FeaturebaseClient = {
    feedback: {
      posts: {
        list,
      },
    },
  };
  mockCreateClient.mockReturnValue(client);
  return list;
}

describe('featurebase issues plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps Featurebase posts to Emdash issues', async () => {
    const list = mockClient(
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

    expect(list).toHaveBeenCalledWith({
      limit: 10,
      sortBy: 'recent',
      sortOrder: 'desc',
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
    const list = mockClient(vi.fn().mockResolvedValue({ data: [] }));

    const result = await issues.searchIssues(host, { searchTerm: ' dark mode ', limit: 5 });

    expect(list).toHaveBeenCalledWith({
      limit: 5,
      sortBy: 'recent',
      sortOrder: 'desc',
      q: 'dark mode',
    });
    expect(result).toEqual({ success: true, data: [] });
  });

  it('does not search Featurebase for an empty term', async () => {
    const list = mockClient(vi.fn());

    const result = await issues.searchIssues(host, { searchTerm: '   ', limit: 5 });

    expect(list).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: [] });
  });

  it('maps Featurebase HTTP failures to a typed issue error', async () => {
    mockClient(
      vi.fn().mockRejectedValue(Object.assign(new Error('Invalid API key'), { status: 401 }))
    );

    const result = await issues.listIssues(host, { limit: 10 });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'auth_failed',
        message: 'Featurebase authentication failed. Check your credentials.',
      },
    });
  });
});
