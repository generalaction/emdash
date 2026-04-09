import type { PullRequest } from '@shared/pull-requests';
import { pullRequests } from '@main/db/schema';

export type PrRow = typeof pullRequests.$inferSelect;

export function prRowToPullRequest(row: PrRow): PullRequest {
  const metadata = JSON.parse(row.metadata ?? '{}') as PullRequest['metadata'];
  const identifier =
    row.provider === 'github' && 'number' in metadata ? `#${metadata.number}` : row.url;

  const author: PullRequest['author'] = row.authorLogin
    ? {
        userName: row.authorLogin,
        displayName: row.authorDisplayName ?? row.authorLogin,
        avatarUrl: row.authorAvatarUrl ?? undefined,
      }
    : row.author
      ? (JSON.parse(row.author) as PullRequest['author'])
      : null;

  return {
    id: row.id,
    identifier,
    nameWithOwner: row.nameWithOwner,
    provider: row.provider as PullRequest['provider'],
    url: row.url,
    title: row.title,
    status: row.status as PullRequest['status'],
    author,
    labels: metadata.labels?.map((l) => ({ name: l.name, color: l.color })) ?? [],
    assignees:
      metadata.assignees?.map((a) => ({
        userName: a.login,
        displayName: a.login,
        avatarUrl: a.avatarUrl,
      })) ?? [],
    isDraft: Boolean(row.isDraft),
    metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
