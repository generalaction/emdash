import { ISSUE_PROVIDER_CAPABILITIES, type IssueListResult } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { clampIssueLimit, normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { log } from '@main/lib/logger';
import {
  featurebaseConnectionService,
  NOT_CONFIGURED_ERROR,
  toFeaturebaseErrorMessage,
} from './featurebase-connection-service';

type FeaturebasePost = {
  id: string;
  slug?: string;
  postUrl?: string;
  title?: string;
  content?: string;
  status?: {
    name?: string;
    type?: string;
  } | null;
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

function toIssue(post: FeaturebasePost): Issue {
  const tags = post.tags?.map((tag) => tag.name).filter((name): name is string => !!name) ?? [];

  return {
    provider: 'featurebase',
    identifier: post.slug ?? post.id,
    title: post.title ?? '',
    url: post.postUrl ?? '',
    description: stripHtml(post.content),
    status: post.status?.name ?? post.status?.type ?? undefined,
    project: tags.length > 0 ? tags.join(', ') : undefined,
    updatedAt: post.updatedAt ?? undefined,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchPosts(opts: { limit: number; searchTerm?: string }): Promise<IssueListResult> {
  const client = await featurebaseConnectionService.getClient();
  if (!client) {
    return {
      success: false,
      error: NOT_CONFIGURED_ERROR,
    };
  }

  const limit = clampIssueLimit(opts.limit, 50, 100);
  const q = normalizeSearchTerm(opts.searchTerm ?? '');

  try {
    const result = await client.get<FeaturebasePostsResponse>('/v2/posts', {
      limit,
      sortBy: 'recent',
      sortOrder: 'desc',
      q: q || undefined,
    });

    return {
      success: true,
      issues: (result.data ?? []).map(toIssue),
    };
  } catch (error) {
    return {
      success: false,
      error: toFeaturebaseErrorMessage(error, 'Failed to fetch Featurebase posts.'),
    };
  }
}

async function searchIssues(searchTerm: string, limit: number): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) {
    return { success: true, issues: [] };
  }

  const result = await fetchPosts({ limit, searchTerm: term });
  if (!result.success) {
    log.error('[Featurebase] searchIssues error:', result.error);
    return result;
  }
  return result;
}

export const featurebaseIssueProvider: IssueProvider = {
  type: 'featurebase',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.featurebase,

  checkConnection: () => featurebaseConnectionService.checkConnection(),

  listIssues: async (opts) => fetchPosts({ limit: opts.limit ?? 50 }),

  searchIssues: async (opts) => searchIssues(opts.searchTerm, opts.limit ?? 20),
};
