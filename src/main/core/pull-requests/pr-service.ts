import type { Octokit } from '@octokit/rest';
import { and, asc, desc, eq, inArray, isNotNull, like, or, sql } from 'drizzle-orm';
import type {
  CheckRunBucket,
  GitHubReviewer,
  ListPrOptions,
  PrCheckRun,
  PrCommentsResult,
  PrFilterOptions,
  PrFilters,
  PrSortField,
  PullRequest,
  PullRequestFile,
  PullRequestStatus,
  User,
} from '@shared/pull-requests';
import { err, ok } from '@shared/result';
import { getOctokit } from '@main/core/github/services/octokit-provider';
import {
  GET_PR_CHECK_RUNS_QUERY,
  GET_PR_DETAIL_QUERY,
  LIST_PRS_QUERY,
  SEARCH_PRS_QUERY,
  SYNC_PRS_QUERY,
} from '@main/core/github/services/pr-queries';
import { parseNameWithOwner, splitRepo } from '@main/core/github/services/utils';
import { projectManager } from '@main/core/projects/project-manager';
import { resolveTask } from '@main/core/projects/utils';
import { db } from '@main/db/client';
import { KV } from '@main/db/kv';
import {
  projectPullRequests,
  pullRequestAssignees,
  pullRequestLabels,
  pullRequests,
} from '@main/db/schema';
import { log } from '@main/lib/logger';

const PR_SYNC_MAX_AGE_MONTHS = 4;

export type TaskPrsPayload = {
  prs: PullRequest[];
  nameWithOwner: string | null;
  taskBranch: string | null;
};

type PrKvSchema = Record<string, string>;

interface GqlPrNode {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  body: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  mergeStateStatus: 'CLEAN' | 'DIRTY' | 'BEHIND' | 'BLOCKED' | 'HAS_HOOKS' | 'UNSTABLE' | 'UNKNOWN';
  author: { login: string; avatarUrl: string } | null;
  headRepository: { nameWithOwner: string; url: string; owner: { login: string } } | null;
  labels: { nodes: Array<{ name: string; color: string }> };
  assignees: { nodes: Array<{ login: string; avatarUrl: string }> };
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  latestReviews: { nodes: Array<{ author: { login: string } | null; state: string }> };
  reviewRequests: { nodes: Array<{ requestedReviewer: { login?: string; name?: string } | null }> };
}

interface GqlCheckRunNode {
  __typename: 'CheckRun';
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  checkSuite: {
    app: { name: string; logoUrl: string } | null;
    workflowRun: { workflow: { name: string } } | null;
  } | null;
}

interface GqlStatusContextNode {
  __typename: 'StatusContext';
  context: string;
  state: string;
  targetUrl: string | null;
  createdAt: string;
}

interface GqlCheckRunsResponse {
  repository: {
    pullRequest: {
      commits: {
        nodes: Array<{
          commit: {
            statusCheckRollup: {
              contexts: {
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
                nodes: Array<GqlCheckRunNode | GqlStatusContextNode>;
              };
            } | null;
          };
        }>;
      };
    } | null;
  };
}

function mapCheckRunBucket(status: string, conclusion: string | null): CheckRunBucket {
  if (
    status === 'IN_PROGRESS' ||
    status === 'QUEUED' ||
    status === 'WAITING' ||
    status === 'PENDING'
  )
    return 'pending';
  if (!conclusion) return 'pending';
  switch (conclusion) {
    case 'SUCCESS':
      return 'pass';
    case 'NEUTRAL':
    case 'SKIPPED':
    case 'STALE':
      return 'skipping';
    case 'FAILURE':
    case 'TIMED_OUT':
    case 'ACTION_REQUIRED':
    case 'STARTUP_FAILURE':
      return 'fail';
    case 'CANCELLED':
      return 'cancel';
    default:
      return 'fail';
  }
}

function mapStatusContextBucket(state: string): CheckRunBucket {
  switch (state) {
    case 'SUCCESS':
      return 'pass';
    case 'FAILURE':
    case 'ERROR':
      return 'fail';
    default:
      return 'pending';
  }
}

// ---------------------------------------------------------------------------
// PrService
// ---------------------------------------------------------------------------

export class PrService {
  private readonly kv = new KV<PrKvSchema>('pr');
  private readonly syncInFlight = new Map<string, Promise<void>>();
  private readonly syncDone = new Set<string>();

  constructor(private readonly getOctokit: () => Promise<Octokit>) {}

  // ── DB-cached reads ──────────────────────────────────────────────────────

  async listPullRequests(
    projectId: string,
    nameWithOwner: string,
    options: ListPrOptions = {},
    invalidate = false
  ): Promise<{ prs: PullRequest[]; syncing: boolean }> {
    if (invalidate) {
      const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
      const searchQuery = options.searchQuery?.trim();
      const octokit = await this.getOctokit();
      const { owner, repo } = splitRepo(nameWithOwner);

      let fresh: PullRequest[];
      if (searchQuery) {
        const response = await octokit.graphql<{
          search: { nodes: GqlPrNode[] };
        }>(SEARCH_PRS_QUERY, {
          searchQuery: `${searchQuery} repo:${owner}/${repo} is:pr is:open`,
          limit,
        });
        fresh = response.search.nodes.map((n) => this.gqlToUnified(n, nameWithOwner));
      } else {
        const response = await octokit.graphql<{
          repository: { pullRequests: { nodes: GqlPrNode[] } };
        }>(LIST_PRS_QUERY, { owner, repo, limit });
        fresh = response.repository.pullRequests.nodes.map((n) =>
          this.gqlToUnified(n, nameWithOwner)
        );
      }

      return { prs: await this.upsertMany(projectId, fresh), syncing: false };
    }

    const key = `${projectId}:${nameWithOwner}`;
    if (!this.syncDone.has(key)) {
      this.deduplicatedSync(projectId, nameWithOwner).catch((e) =>
        log.error('Background PR sync failed:', e)
      );
    }

    const prs = await this.fromDb(
      nameWithOwner,
      options.filters,
      { limit: options.limit ?? 50, offset: options.offset ?? 0 },
      options.sort,
      options.searchQuery
    );
    const syncing = this.syncInFlight.has(`${projectId}:${nameWithOwner}`);
    return { prs, syncing };
  }

  async getPullRequest(
    nameWithOwner: string,
    prNumber: number,
    invalidate = false
  ): Promise<PullRequest | null> {
    if (invalidate) {
      const { owner, repo } = splitRepo(nameWithOwner);
      const octokit = await this.getOctokit();
      const response = await octokit.graphql<{
        repository: { pullRequest: GqlPrNode | null };
      }>(GET_PR_DETAIL_QUERY, { owner, repo, number: prNumber });
      const node = response.repository.pullRequest;
      if (!node) return null;
      return this.upsertSingle(this.gqlToUnified(node, nameWithOwner));
    }

    const rows = await db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.nameWithOwner, nameWithOwner))
      .limit(1);

    for (const row of rows) {
      const pr = this.dbRowToUnified(row);
      if (pr.metadata.number === prNumber) return pr;
    }
    return null;
  }

  async getPullRequestsForTask(
    projectId: string,
    taskId: string,
    invalidate = false
  ): Promise<
    | { success: true; data: TaskPrsPayload }
    | { success: false; error: { type: 'not_found' } | string }
  > {
    try {
      const project = projectManager.getProject(projectId);
      const env = resolveTask(projectId, taskId);
      if (!project || !env) return err({ type: 'not_found' as const });
      if (!env.taskBranch) {
        return ok<TaskPrsPayload>({ prs: [], nameWithOwner: null, taskBranch: null });
      }

      const taskBranch = env.taskBranch;
      const remoteName = await project.settings.getRemote();
      const remotes = await env.workspace.git.getRemotes();
      const remoteUrl = remotes.find((r) => r.name === remoteName)?.url;
      const nameWithOwner = remoteUrl ? parseNameWithOwner(remoteUrl) : null;

      if (!nameWithOwner) {
        return ok<TaskPrsPayload>({ prs: [], nameWithOwner: null, taskBranch });
      }

      if (invalidate) {
        const octokit = await this.getOctokit();
        const response = await octokit.graphql<{ search: { nodes: GqlPrNode[] } }>(
          SEARCH_PRS_QUERY,
          { searchQuery: `repo:${nameWithOwner} is:pr head:${taskBranch}`, limit: 25 }
        );
        const fresh = response.search.nodes.map((n) => this.gqlToUnified(n, nameWithOwner));
        const prs = await this.upsertMany(projectId, fresh);
        return ok<TaskPrsPayload>({ prs, nameWithOwner, taskBranch });
      }

      const prs = await this.fromDb(nameWithOwner);
      const taskPrs = prs.filter((pr) => pr.metadata.headRefName === taskBranch);
      return ok<TaskPrsPayload>({ prs: taskPrs, nameWithOwner, taskBranch });
    } catch (error) {
      log.error('Failed to get pull requests for task:', error);
      const env2 = resolveTask(projectId, taskId);
      return ok<TaskPrsPayload>({
        prs: [],
        nameWithOwner: null,
        taskBranch: env2?.taskBranch ?? null,
      });
    }
  }

  async getFilterOptions(nameWithOwner: string): Promise<PrFilterOptions> {
    const [authorRows, labelRows, assigneeRows] = await Promise.all([
      db
        .selectDistinct({
          authorLogin: pullRequests.authorLogin,
          authorDisplayName: pullRequests.authorDisplayName,
          authorAvatarUrl: pullRequests.authorAvatarUrl,
        })
        .from(pullRequests)
        .where(
          and(eq(pullRequests.nameWithOwner, nameWithOwner), isNotNull(pullRequests.authorLogin))
        ),
      db
        .selectDistinct({ name: pullRequestLabels.name, color: pullRequestLabels.color })
        .from(pullRequestLabels)
        .innerJoin(pullRequests, eq(pullRequests.id, pullRequestLabels.pullRequestId))
        .where(eq(pullRequests.nameWithOwner, nameWithOwner)),
      db
        .selectDistinct({
          login: pullRequestAssignees.login,
          avatarUrl: pullRequestAssignees.avatarUrl,
        })
        .from(pullRequestAssignees)
        .innerJoin(pullRequests, eq(pullRequests.id, pullRequestAssignees.pullRequestId))
        .where(eq(pullRequests.nameWithOwner, nameWithOwner)),
    ]);

    return {
      authors: authorRows
        .filter((r) => r.authorLogin != null)
        .map((r) => ({
          userName: r.authorLogin!,
          displayName: r.authorDisplayName ?? r.authorLogin!,
          avatarUrl: r.authorAvatarUrl ?? undefined,
        })),
      labels: labelRows.map((r) => ({ name: r.name, color: r.color ?? undefined })),
      assignees: assigneeRows.map((r) => ({
        userName: r.login,
        displayName: r.login,
        avatarUrl: r.avatarUrl ?? undefined,
      })),
    };
  }

  // ── Mutations (always refresh cache after write) ─────────────────────────

  async createPullRequest(params: {
    nameWithOwner: string;
    head: string;
    base: string;
    title: string;
    body?: string;
    draft: boolean;
  }): Promise<{ url: string; number: number }> {
    const octokit = await this.getOctokit();
    const { owner, repo } = splitRepo(params.nameWithOwner);
    const response = await octokit.rest.pulls.create({
      owner,
      repo,
      head: params.head,
      base: params.base,
      title: params.title,
      body: params.body,
      draft: params.draft,
    });
    const { html_url: url, number } = response.data;
    await this.getPullRequest(params.nameWithOwner, number, true);
    return { url, number };
  }

  async mergePullRequest(
    nameWithOwner: string,
    prNumber: number,
    options: { strategy: 'merge' | 'squash' | 'rebase'; commitHeadOid?: string }
  ): Promise<{ sha: string | null; merged: boolean }> {
    const octokit = await this.getOctokit();
    const { owner, repo } = splitRepo(nameWithOwner);
    const response = await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
      merge_method: options.strategy,
      sha: options.commitHeadOid,
    });
    await this.getPullRequest(nameWithOwner, prNumber, true);
    return { sha: response.data.sha ?? null, merged: response.data.merged };
  }

  async markReadyForReview(nameWithOwner: string, prNumber: number): Promise<void> {
    const octokit = await this.getOctokit();
    const { owner, repo } = splitRepo(nameWithOwner);
    const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
    await octokit.graphql(
      `mutation MarkReadyForReview($id: ID!) {
        markPullRequestReadyForReview(input: { pullRequestId: $id }) {
          pullRequest { isDraft }
        }
      }`,
      { id: data.node_id }
    );
    await this.getPullRequest(nameWithOwner, prNumber, true);
  }

  // ── Pass-through reads (no DB involvement) ───────────────────────────────

  async getCheckRuns(nameWithOwner: string, prNumber: number): Promise<PrCheckRun[]> {
    const octokit = await this.getOctokit();
    const { owner, repo } = splitRepo(nameWithOwner);

    const allNodes: Array<GqlCheckRunNode | GqlStatusContextNode> = [];
    let cursor: string | undefined;

    for (;;) {
      const response: GqlCheckRunsResponse = await octokit.graphql(GET_PR_CHECK_RUNS_QUERY, {
        owner,
        repo,
        number: prNumber,
        cursor,
      });
      const contexts =
        response.repository.pullRequest?.commits.nodes[0]?.commit?.statusCheckRollup?.contexts;
      if (!contexts) break;
      allNodes.push(...contexts.nodes);
      if (!contexts.pageInfo.hasNextPage) break;
      cursor = contexts.pageInfo.endCursor ?? undefined;
    }

    return allNodes.map((node) => {
      if (node.__typename === 'CheckRun') {
        return {
          name: node.name,
          bucket: mapCheckRunBucket(node.status, node.conclusion),
          workflowName: node.checkSuite?.workflowRun?.workflow?.name,
          appName: node.checkSuite?.app?.name,
          appLogoUrl: node.checkSuite?.app?.logoUrl,
          detailsUrl: node.detailsUrl ?? undefined,
          startedAt: node.startedAt ?? undefined,
          completedAt: node.completedAt ?? undefined,
        };
      }
      return {
        name: node.context,
        bucket: mapStatusContextBucket(node.state),
        detailsUrl: node.targetUrl ?? undefined,
        startedAt: node.createdAt,
      };
    });
  }

  async getPullRequestFiles(nameWithOwner: string, prNumber: number): Promise<PullRequestFile[]> {
    const octokit = await this.getOctokit();
    const { owner, repo } = splitRepo(nameWithOwner);
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });
    return files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));
  }

  async getPrComments(nameWithOwner: string, prNumber: number): Promise<PrCommentsResult> {
    const octokit = await this.getOctokit();
    const { owner, repo } = splitRepo(nameWithOwner);

    const [commentsData, reviewsData] = await Promise.all([
      octokit.paginate(octokit.rest.issues.listComments, {
        owner,
        repo,
        issue_number: prNumber,
        per_page: 100,
      }),
      octokit.paginate(octokit.rest.pulls.listReviews, {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      }),
    ]);

    return {
      comments: commentsData.map((c) => ({
        id: c.id,
        author: { login: c.user?.login ?? 'unknown', avatarUrl: c.user?.avatar_url },
        body: c.body ?? '',
        createdAt: c.created_at,
      })),
      reviews: reviewsData
        .filter(
          (r) =>
            r.state !== 'PENDING' &&
            (r.body || r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED')
        )
        .map((r) => {
          const fallbackSubmittedAt =
            'updated_at' in r && typeof r.updated_at === 'string' ? r.updated_at : undefined;
          return {
            id: r.id,
            author: { login: r.user?.login ?? 'unknown', avatarUrl: r.user?.avatar_url },
            body: r.body ?? '',
            submittedAt: r.submitted_at ?? fallbackSubmittedAt,
            state: r.state,
          };
        }),
    };
  }

  async addPrComment(
    nameWithOwner: string,
    prNumber: number,
    body: string
  ): Promise<{ id: number }> {
    const octokit = await this.getOctokit();
    const { owner, repo } = splitRepo(nameWithOwner);
    const response = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
    return { id: response.data.id };
  }

  // ── Project bootstrap sync ───────────────────────────────────────────────

  async syncPullRequests(projectId: string, nameWithOwner: string): Promise<void> {
    const sinceUpdatedAt = await this.getLatestUpdatedAt(nameWithOwner);
    const { owner, repo } = splitRepo(nameWithOwner);
    const octokit = await this.getOctokit();

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - PR_SYNC_MAX_AGE_MONTHS);
    const cutoffISO = cutoff.toISOString();

    let cursor: string | undefined;

    for (;;) {
      const response = await octokit.graphql<{
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: GqlPrNode[];
          };
        };
      }>(SYNC_PRS_QUERY, { owner, repo, cursor });

      const { nodes, pageInfo } = response.repository.pullRequests;
      const pageBatch: PullRequest[] = [];
      let reachedCursor = false;
      for (const node of nodes) {
        if (node.updatedAt < cutoffISO) {
          reachedCursor = true;
          break;
        }
        if (sinceUpdatedAt && node.updatedAt <= sinceUpdatedAt) {
          reachedCursor = true;
          break;
        }
        pageBatch.push(this.gqlToUnified(node, nameWithOwner));
      }

      if (pageBatch.length > 0) {
        await this.upsertMany(projectId, pageBatch);
      }

      if (reachedCursor || !pageInfo.hasNextPage) break;
      cursor = pageInfo.endCursor ?? undefined;
    }

    await this.kv.set(`${projectId}:${nameWithOwner}:lastFetchedAt`, new Date().toISOString());
  }

  // ── Private: dedup sync guard ────────────────────────────────────────────

  private deduplicatedSync(projectId: string, nameWithOwner: string): Promise<void> {
    const key = `${projectId}:${nameWithOwner}`;
    const existing = this.syncInFlight.get(key);
    if (existing) return existing;
    const promise = this.syncPullRequests(projectId, nameWithOwner).finally(() => {
      this.syncInFlight.delete(key);
      this.syncDone.add(key);
    });
    this.syncInFlight.set(key, promise);
    return promise;
  }

  // ── Private: DB helpers ──────────────────────────────────────────────────

  private async upsertSingle(pr: PullRequest, projectId?: string): Promise<PullRequest> {
    const serialized = this.serialize(pr);

    const [row] = await db
      .insert(pullRequests)
      .values({ id: pr.url, ...serialized, fetchedAt: sql`CURRENT_TIMESTAMP` })
      .onConflictDoUpdate({
        target: pullRequests.url,
        set: { ...serialized, fetchedAt: sql`CURRENT_TIMESTAMP` },
      })
      .returning();

    await db.delete(pullRequestLabels).where(eq(pullRequestLabels.pullRequestId, pr.id));
    if (pr.metadata.labels.length > 0) {
      await db.insert(pullRequestLabels).values(
        pr.metadata.labels.map((l) => ({
          pullRequestId: pr.id,
          name: l.name,
          color: l.color ?? null,
        }))
      );
    }

    await db.delete(pullRequestAssignees).where(eq(pullRequestAssignees.pullRequestId, pr.id));
    if (pr.metadata.assignees.length > 0) {
      await db.insert(pullRequestAssignees).values(
        pr.metadata.assignees.map((a) => ({
          pullRequestId: pr.id,
          login: a.login,
          avatarUrl: a.avatarUrl ?? null,
        }))
      );
    }

    if (projectId) {
      await db
        .insert(projectPullRequests)
        .values({ projectId, pullRequestUrl: pr.url })
        .onConflictDoNothing();
    }

    return this.dbRowToUnified(row);
  }

  private async upsertMany(projectId: string, prs: PullRequest[]): Promise<PullRequest[]> {
    const CHUNK = 10;
    const results: PullRequest[] = [];
    for (let i = 0; i < prs.length; i += CHUNK) {
      const chunk = await Promise.all(
        prs.slice(i, i + CHUNK).map((pr) => this.upsertSingle(pr, projectId))
      );
      results.push(...chunk);
    }
    return results;
  }

  private async fromDb(
    nameWithOwner: string,
    filters?: PrFilters,
    pagination?: { limit: number; offset: number },
    sort?: PrSortField,
    searchQuery?: string
  ): Promise<PullRequest[]> {
    const conditions = [eq(pullRequests.nameWithOwner, nameWithOwner)];

    if (filters?.status && filters.status !== 'all') {
      if (filters.status === 'not-open') {
        conditions.push(inArray(pullRequests.status, ['closed', 'merged']));
      } else {
        conditions.push(eq(pullRequests.status, filters.status));
      }
    }

    if (filters?.authorLogins && filters.authorLogins.length > 0) {
      conditions.push(inArray(pullRequests.authorLogin, filters.authorLogins));
    }

    if (filters?.labelNames && filters.labelNames.length > 0) {
      const labelSubquery = db
        .select({ id: pullRequestLabels.pullRequestId })
        .from(pullRequestLabels)
        .where(inArray(pullRequestLabels.name, filters.labelNames));
      conditions.push(inArray(pullRequests.id, labelSubquery));
    }

    if (filters?.assigneeLogins && filters.assigneeLogins.length > 0) {
      const assigneeSubquery = db
        .select({ id: pullRequestAssignees.pullRequestId })
        .from(pullRequestAssignees)
        .where(inArray(pullRequestAssignees.login, filters.assigneeLogins));
      conditions.push(inArray(pullRequests.id, assigneeSubquery));
    }

    if (searchQuery?.trim()) {
      const pattern = `%${searchQuery.trim()}%`;
      conditions.push(
        or(like(pullRequests.title, pattern), like(pullRequests.identifier, pattern))!
      );
    }

    const orderClause =
      sort === 'oldest'
        ? asc(pullRequests.createdAt)
        : sort === 'recently-updated'
          ? desc(pullRequests.updatedAt)
          : desc(pullRequests.createdAt);

    const query = db
      .select()
      .from(pullRequests)
      .where(and(...conditions))
      .orderBy(orderClause);

    const rows = pagination
      ? await query.limit(pagination.limit).offset(pagination.offset)
      : await query;

    return rows.map((r) => this.dbRowToUnified(r));
  }

  private async getLatestUpdatedAt(nameWithOwner: string): Promise<string | undefined> {
    const [row] = await db
      .select({ updatedAt: pullRequests.updatedAt })
      .from(pullRequests)
      .where(eq(pullRequests.nameWithOwner, nameWithOwner))
      .orderBy(desc(pullRequests.updatedAt))
      .limit(1);
    return row?.updatedAt;
  }

  // ── Private: GraphQL → unified model ────────────────────────────────────

  private gqlToUnified(node: GqlPrNode, nameWithOwner: string): PullRequest {
    const status: PullRequestStatus =
      node.state === 'MERGED' ? 'merged' : node.state === 'CLOSED' ? 'closed' : 'open';

    const reviewerMap = new Map<string, GitHubReviewer>();
    for (const req of node.reviewRequests.nodes) {
      const login = req.requestedReviewer?.login ?? req.requestedReviewer?.name;
      if (login) reviewerMap.set(login, { login, state: 'PENDING' });
    }
    for (const review of node.latestReviews.nodes) {
      const login = review.author?.login;
      if (login) reviewerMap.set(login, { login, state: review.state as GitHubReviewer['state'] });
    }

    const author: User | null = node.author
      ? {
          userName: node.author.login,
          displayName: node.author.login,
          avatarUrl: node.author.avatarUrl || undefined,
        }
      : null;

    return {
      id: node.url,
      identifier: `#${node.number}`,
      nameWithOwner,
      provider: 'github',
      url: node.url,
      title: node.title,
      status,
      author,
      labels: node.labels.nodes.map((l) => ({ name: l.name, color: l.color })),
      assignees: node.assignees.nodes.map((a) => ({
        userName: a.login,
        displayName: a.login,
        avatarUrl: a.avatarUrl,
      })),
      isDraft: node.isDraft,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      metadata: {
        number: node.number,
        headRefName: node.headRefName,
        headRefOid: node.headRefOid,
        baseRefName: node.baseRefName,
        headRepository: node.headRepository,
        labels: node.labels.nodes,
        assignees: node.assignees.nodes,
        reviewDecision: node.reviewDecision,
        reviewers: Array.from(reviewerMap.values()),
        additions: node.additions,
        deletions: node.deletions,
        changedFiles: node.changedFiles,
        mergeable: node.mergeable,
        mergeStateStatus: node.mergeStateStatus,
        body: node.body,
      },
    };
  }

  // ── Private: DB serialize / deserialize ──────────────────────────────────

  private serialize(pr: PullRequest) {
    return {
      provider: pr.provider,
      nameWithOwner: pr.nameWithOwner,
      url: pr.url,
      title: pr.title,
      identifier: pr.identifier,
      status: pr.status,
      author: JSON.stringify(pr.author),
      authorLogin: pr.author?.userName ?? null,
      authorDisplayName: pr.author?.displayName ?? null,
      authorAvatarUrl: pr.author?.avatarUrl ?? null,
      isDraft: Number(pr.isDraft),
      metadata: JSON.stringify(pr.metadata),
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
    };
  }

  private dbRowToUnified(row: typeof pullRequests.$inferSelect): PullRequest {
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
}

export const prService = new PrService(getOctokit);
