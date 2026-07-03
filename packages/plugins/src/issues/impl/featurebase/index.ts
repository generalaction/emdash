import { err, ok } from '@emdash/shared';
import {
  getFeaturebaseClient,
  toFeaturebaseErrorMessage,
} from '../../../integrations/impl/featurebase/client';
import { clampIssueLimit, issueError, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueData, IssueListResult } from '../../types';

type FeaturebasePost = {
  id: string;
  slug?: string;
  postUrl?: string;
  title?: string;
  content?: string;
  status?: { name?: string; type?: string } | null;
  tags?: Array<{ name?: string }>;
  updatedAt?: string;
};

type FeaturebasePostsResponse = {
  data?: FeaturebasePost[];
};

function stripHtml(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const stripped = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();

  return stripped || undefined;
}

function toIssue(post: FeaturebasePost): IssueData {
  const tags = post.tags?.map((tag) => tag.name).filter((name): name is string => !!name) ?? [];

  return {
    identifier: post.slug ?? post.id,
    title: post.title ?? '',
    url: post.postUrl ?? '',
    description: stripHtml(post.content),
    status: post.status?.name ?? post.status?.type ?? undefined,
    project: tags.length > 0 ? tags.join(', ') : undefined,
    updatedAt: post.updatedAt ?? undefined,
  };
}

async function fetchPosts(
  host: Parameters<typeof getFeaturebaseClient>[0],
  opts: { limit: number; searchTerm?: string }
): Promise<IssueListResult> {
  const client = getFeaturebaseClient(host);
  const limit = clampIssueLimit(opts.limit, 50, 100);
  const q = normalizeSearchTerm(opts.searchTerm ?? '');

  try {
    const result = await client.get<FeaturebasePostsResponse>('/v2/posts', {
      limit,
      sortBy: 'recent',
      sortOrder: 'desc',
      q: q || undefined,
    });
    return ok((result.data ?? []).map(toIssue));
  } catch (error) {
    return err(
      issueError('generic', toFeaturebaseErrorMessage(error, 'Failed to fetch Featurebase posts.'))
    );
  }
}

const plugin = defineIssuesPlugin({ integrationId: 'featurebase' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    listIssues: (host, opts) => fetchPosts(host.credentials, { limit: opts.limit }),
    async searchIssues(host, opts) {
      const term = normalizeSearchTerm(opts.searchTerm);
      if (!term) return ok([]);
      const result = await fetchPosts(host.credentials, { limit: opts.limit, searchTerm: term });
      if (!result.success)
        host.log.error('[Featurebase] searchIssues error', { error: result.error });
      return result;
    },
  },
});
