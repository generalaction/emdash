import type { Post } from 'featurebase-node/resources/feedback/posts/posts';
import type { IssueData } from '../../types';

export function toIssue(post: Post): IssueData {
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
