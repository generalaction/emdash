import type { Octokit } from '@octokit/rest';
import { desc, eq, sql } from 'drizzle-orm';
import type {
  CheckRunBucket,
  GitHubReviewer,
  PrCheckRun,
  PrCommentsResult,
  PullRequest,
  PullRequestFile,
  PullRequestStatus,
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
import { pullRequests } from '@main/db/schema';
import { log } from '@main/lib/logger';

// ---------------------------------------------------------------------------
// Public payload types
// ---------------------------------------------------------------------------

export type TaskPrsPayload = {
  prs: PullRequest[];
  nameWithOwner: string | null;
  taskBranch: string | null;
};

export type ListPrOptions = {
  limit?: number;
  searchQuery?: string;
};

// ---------------------------------------------------------------------------
// GraphQL response shapes (internal)
// ---------------------------------------------------------------------------

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
  author: { login: string } | null;
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

// ---------------------------------------------------------------------------
// Bucket mappers
// ---------------------------------------------------------------------------

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
  constructor(private readonly getOctokit: () => Promise<Octokit>) {}

  // ── DB-cached reads ──────────────────────────────────────────────────────

  async listPullRequests(
    nameWithOwner: string,
    options: ListPrOptions = {},
    invalidate = false
  ): Promise<PullRequest[]> {
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

      return this.upsertMany(fresh);
    }

    return this.fromDb(nameWithOwner);
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
      return this.upsert(this.gqlToUnified(node, nameWithOwner));
    }

    const rows = await db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.nameWithOwner, nameWithOwner))
      .limit(1);

    // Try to find by number in the metadata JSON — fall back to null
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
      const remotes = await env.git.getRemotes();
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
        const prs = await this.upsertMany(fresh);
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

  async syncPullRequests(nameWithOwner: string): Promise<void> {
    const sinceUpdatedAt = await this.getLatestUpdatedAt(nameWithOwner);
    const { owner, repo } = splitRepo(nameWithOwner);
    const octokit = await this.getOctokit();
    const toUpsert: PullRequest[] = [];
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
      let reachedCursor = false;
      for (const node of nodes) {
        if (sinceUpdatedAt && node.updatedAt <= sinceUpdatedAt) {
          reachedCursor = true;
          break;
        }
        toUpsert.push(this.gqlToUnified(node, nameWithOwner));
      }

      if (reachedCursor || !pageInfo.hasNextPage) break;
      cursor = pageInfo.endCursor ?? undefined;
    }

    if (toUpsert.length > 0) {
      await this.upsertMany(toUpsert);
    }
  }

  // ── Private: DB helpers ──────────────────────────────────────────────────

  private async upsert(pr: PullRequest): Promise<PullRequest> {
    const serialized = this.serialize(pr);
    const [row] = await db
      .insert(pullRequests)
      .values({ id: pr.url, ...serialized, fetchedAt: sql`CURRENT_TIMESTAMP` })
      .onConflictDoUpdate({
        target: pullRequests.url,
        set: { ...serialized, fetchedAt: sql`CURRENT_TIMESTAMP` },
      })
      .returning();
    return this.dbRowToUnified(row);
  }

  private async upsertMany(prs: PullRequest[]): Promise<PullRequest[]> {
    return Promise.all(prs.map((pr) => this.upsert(pr)));
  }

  private async fromDb(nameWithOwner: string): Promise<PullRequest[]> {
    const rows = await db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.nameWithOwner, nameWithOwner))
      .orderBy(desc(pullRequests.updatedAt));
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

    return {
      id: node.url,
      identifier: `#${node.number}`,
      nameWithOwner,
      provider: 'github',
      url: node.url,
      title: node.title,
      status,
      author: node.author ? { userName: node.author.login, displayName: node.author.login } : null,
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
      status: pr.status,
      author: JSON.stringify(pr.author),
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
}

export const prService = new PrService(getOctokit);
