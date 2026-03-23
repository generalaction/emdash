import { desc, eq, sql } from 'drizzle-orm';
import { pullRequests } from '@/main/db/schema';
import type { PullRequest } from '@shared/pull-requests';
import { db } from '@main/db/client';

function serializePr(pr: Omit<PullRequest, 'id'>) {
  return {
    provider: pr.provider,
    nameWithOwner: pr.nameWithOwner,
    url: pr.url,
    title: pr.title,
    status: pr.status,
    author: JSON.stringify(pr.author),
    isDraft: Number(pr.isDraft),
    metadata: JSON.stringify(pr.metadata),
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
  };
}

function deserializePr(row: typeof pullRequests.$inferSelect): PullRequest {
  const metadata = JSON.parse(row.metadata ?? '{}') as PullRequest['metadata'];
  const identifier =
    row.provider === 'github' && 'number' in metadata ? `#${metadata.number}` : row.url;
  return {
    id: row.id,
    identifier,
    nameWithOwner: row.nameWithOwner,
    provider: row.provider as PullRequest['provider'],
    url: row.url,
    title: row.title,
    status: row.status as PullRequest['status'],
    author: row.author ? JSON.parse(row.author) : null,
    isDraft: Boolean(row.isDraft),
    metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PullRequestProvider {
  async upsertPullRequest(pr: Omit<PullRequest, 'id'>): Promise<PullRequest> {
    const serialized = serializePr(pr);
    const [row] = await db
      .insert(pullRequests)
      .values({
        id: pr.url,
        ...serialized,
        fetchedAt: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoUpdate({
        target: pullRequests.url,
        set: {
          ...serialized,
          fetchedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .returning();
    return deserializePr(row);
  }

  async upsertPullRequests(prs: Omit<PullRequest, 'id'>[]): Promise<PullRequest[]> {
    const results: PullRequest[] = [];
    for (const pr of prs) {
      results.push(await this.upsertPullRequest(pr));
    }
    return results;
  }

  async getPullRequestById(id: string): Promise<PullRequest | undefined> {
    const [row] = await db.select().from(pullRequests).where(eq(pullRequests.id, id)).limit(1);
    if (!row) return undefined;
    return deserializePr(row);
  }

  async listPullRequests(nameWithOwner: string): Promise<PullRequest[]> {
    const rows = await db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.nameWithOwner, nameWithOwner))
      .orderBy(desc(pullRequests.updatedAt));
    return rows.map(deserializePr);
  }

  async getLatestUpdatedAt(nameWithOwner: string): Promise<string | undefined> {
    const [row] = await db
      .select({ updatedAt: pullRequests.updatedAt })
      .from(pullRequests)
      .where(eq(pullRequests.nameWithOwner, nameWithOwner))
      .orderBy(desc(pullRequests.updatedAt))
      .limit(1);
    return row?.updatedAt;
  }

  async deletePullRequest(id: string): Promise<void> {
    await db.delete(pullRequests).where(eq(pullRequests.id, id));
  }
}

export const pullRequestProvider = new PullRequestProvider();
