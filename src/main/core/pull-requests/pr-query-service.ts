import { and, asc, desc, eq, inArray, isNotNull, like, or } from 'drizzle-orm';
import { parseGitHubRepository } from '@shared/github-repository';
import type { Label, ListPrOptions, PrFilterOptions, PullRequest } from '@shared/pull-requests';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import {
  projectRemotes,
  pullRequestAssignees,
  pullRequestChecks,
  pullRequestLabels,
  pullRequests,
  pullRequestUsers,
} from '@main/db/schema';
import { assemblePullRequest, type PrRow } from './pr-utils';

/** Internal capability type — not exposed to the renderer. */
export type ProjectRemoteCapability =
  | { status: 'ready'; repositoryUrl: string }
  | { status: 'no_remote' }
  | { status: 'unsupported_remote' };

async function fetchRelated(rows: PrRow[]): Promise<PullRequest[]> {
  if (rows.length === 0) return [];

  const urls = rows.map((r) => r.url);

  const [labelRows, assigneeJoins, checkRows] = await Promise.all([
    db.select().from(pullRequestLabels).where(inArray(pullRequestLabels.pullRequestId, urls)),
    db
      .select({ pullRequestUrl: pullRequestAssignees.pullRequestUrl, user: pullRequestUsers })
      .from(pullRequestAssignees)
      .innerJoin(pullRequestUsers, eq(pullRequestAssignees.userId, pullRequestUsers.userId))
      .where(inArray(pullRequestAssignees.pullRequestUrl, urls)),
    db.select().from(pullRequestChecks).where(inArray(pullRequestChecks.pullRequestUrl, urls)),
  ]);

  // Collect all author user IDs
  const authorIds = [
    ...new Set(rows.map((r) => r.authorUserId).filter((id): id is string => id !== null)),
  ];
  const authorMap = new Map<string, typeof pullRequestUsers.$inferSelect>();
  if (authorIds.length > 0) {
    const authors = await db
      .select()
      .from(pullRequestUsers)
      .where(inArray(pullRequestUsers.userId, authorIds));
    for (const a of authors) authorMap.set(a.userId, a);
  }

  const labelsByUrl = new Map<string, (typeof pullRequestLabels.$inferSelect)[]>();
  for (const l of labelRows) {
    const arr = labelsByUrl.get(l.pullRequestId) ?? [];
    arr.push(l);
    labelsByUrl.set(l.pullRequestId, arr);
  }

  const assigneesByUrl = new Map<string, (typeof pullRequestUsers.$inferSelect)[]>();
  for (const a of assigneeJoins) {
    const arr = assigneesByUrl.get(a.pullRequestUrl) ?? [];
    arr.push(a.user);
    assigneesByUrl.set(a.pullRequestUrl, arr);
  }

  const checksByUrl = new Map<string, (typeof pullRequestChecks.$inferSelect)[]>();
  for (const c of checkRows) {
    const arr = checksByUrl.get(c.pullRequestUrl) ?? [];
    arr.push(c);
    checksByUrl.set(c.pullRequestUrl, arr);
  }

  return rows.map((row) =>
    assemblePullRequest(
      row,
      row.authorUserId ? (authorMap.get(row.authorUserId) ?? null) : null,
      labelsByUrl.get(row.url) ?? [],
      assigneesByUrl.get(row.url) ?? [],
      checksByUrl.get(row.url) ?? []
    )
  );
}

export class PrQueryService {
  async listPullRequests(projectId: string, options: ListPrOptions = {}): Promise<PullRequest[]> {
    let repositoryUrls: string[];

    if (options.repositoryUrl) {
      repositoryUrls = [options.repositoryUrl];
    } else {
      const remoteRows = await db
        .select({ remoteUrl: projectRemotes.remoteUrl })
        .from(projectRemotes)
        .where(eq(projectRemotes.projectId, projectId));

      if (remoteRows.length === 0) return [];
      repositoryUrls = remoteRows.map((r) => r.remoteUrl);
    }

    const conditions = [inArray(pullRequests.repositoryUrl, repositoryUrls)];

    const filters = options.filters;
    if (filters?.status && filters.status !== 'all') {
      if (filters.status === 'not-open') {
        conditions.push(inArray(pullRequests.status, ['closed', 'merged']));
      } else {
        conditions.push(eq(pullRequests.status, filters.status));
      }
    }

    if (filters?.authorUserIds && filters.authorUserIds.length > 0) {
      conditions.push(inArray(pullRequests.authorUserId, filters.authorUserIds));
    }

    if (filters?.labelNames && filters.labelNames.length > 0) {
      const labelSub = db
        .select({ id: pullRequestLabels.pullRequestId })
        .from(pullRequestLabels)
        .where(inArray(pullRequestLabels.name, filters.labelNames));
      conditions.push(inArray(pullRequests.url, labelSub));
    }

    if (filters?.assigneeUserIds && filters.assigneeUserIds.length > 0) {
      const assigneeSub = db
        .select({ id: pullRequestAssignees.pullRequestUrl })
        .from(pullRequestAssignees)
        .where(inArray(pullRequestAssignees.userId, filters.assigneeUserIds));
      conditions.push(inArray(pullRequests.url, assigneeSub));
    }

    if (options.searchQuery?.trim()) {
      const pattern = `%${options.searchQuery.trim()}%`;
      conditions.push(
        or(like(pullRequests.title, pattern), like(pullRequests.identifier, pattern))!
      );
    }

    const orderClause =
      options.sort === 'oldest'
        ? asc(pullRequests.pullRequestCreatedAt)
        : options.sort === 'recently-updated'
          ? desc(pullRequests.pullRequestUpdatedAt)
          : desc(pullRequests.pullRequestCreatedAt);

    const query = db
      .select()
      .from(pullRequests)
      .where(and(...conditions))
      .orderBy(orderClause);

    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const rows = await query.limit(limit).offset(offset);

    return fetchRelated(rows);
  }

  async getTaskPullRequests(
    projectId: string,
    taskBranch: string,
    repositoryUrl: string
  ): Promise<PullRequest[]> {
    const rows = await db
      .select()
      .from(pullRequests)
      .where(
        and(eq(pullRequests.headRefName, taskBranch), eq(pullRequests.repositoryUrl, repositoryUrl))
      );

    return fetchRelated(rows);
  }

  async getFilterOptions(projectId: string): Promise<PrFilterOptions> {
    const remoteRows = await db
      .select({ remoteUrl: projectRemotes.remoteUrl })
      .from(projectRemotes)
      .where(eq(projectRemotes.projectId, projectId));

    if (remoteRows.length === 0) {
      return { authors: [], labels: [], assignees: [] };
    }

    const repositoryUrls = remoteRows.map((r) => r.remoteUrl);
    const prUrlsSub = db
      .select({ url: pullRequests.url })
      .from(pullRequests)
      .where(inArray(pullRequests.repositoryUrl, repositoryUrls));

    const authorUserIdsSub = db
      .select({ userId: pullRequests.authorUserId })
      .from(pullRequests)
      .where(and(inArray(pullRequests.url, prUrlsSub), isNotNull(pullRequests.authorUserId)));

    const assigneeUserIdsSub = db
      .select({ userId: pullRequestAssignees.userId })
      .from(pullRequestAssignees)
      .where(inArray(pullRequestAssignees.pullRequestUrl, prUrlsSub));

    const [authorRows, labelRows, assigneeRows] = await Promise.all([
      db.select().from(pullRequestUsers).where(inArray(pullRequestUsers.userId, authorUserIdsSub)),
      db
        .selectDistinct({ name: pullRequestLabels.name, color: pullRequestLabels.color })
        .from(pullRequestLabels)
        .where(inArray(pullRequestLabels.pullRequestId, prUrlsSub)),
      db
        .select()
        .from(pullRequestUsers)
        .where(inArray(pullRequestUsers.userId, assigneeUserIdsSub)),
    ]);

    const labels: Label[] = labelRows.map((r) => ({
      name: r.name,
      color: r.color ?? null,
    }));

    return {
      authors: authorRows.map((r) => ({
        userId: r.userId,
        userName: r.userName,
        displayName: r.displayName ?? null,
        avatarUrl: r.avatarUrl ?? null,
        url: r.url ?? null,
        userUpdatedAt: r.userUpdatedAt ?? null,
        userCreatedAt: r.userCreatedAt ?? null,
      })),
      labels,
      assignees: assigneeRows.map((r) => ({
        userId: r.userId,
        userName: r.userName,
        displayName: r.displayName ?? null,
        avatarUrl: r.avatarUrl ?? null,
        url: r.url ?? null,
        userUpdatedAt: r.userUpdatedAt ?? null,
        userCreatedAt: r.userCreatedAt ?? null,
      })),
    };
  }

  async getProjectRemoteInfo(projectId: string): Promise<ProjectRemoteCapability> {
    const project = projectManager.getProject(projectId);
    if (!project) return { status: 'no_remote' };

    const remoteState = await project.getRemoteState();
    if (!remoteState.hasRemote) return { status: 'no_remote' };
    if (!remoteState.selectedRemoteUrl) return { status: 'unsupported_remote' };

    const repository = parseGitHubRepository(remoteState.selectedRemoteUrl);
    if (!repository) return { status: 'unsupported_remote' };

    return {
      status: 'ready',
      repositoryUrl: repository.repositoryUrl,
    };
  }
}

export const prQueryService = new PrQueryService();
