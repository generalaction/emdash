import { parseRepositoryRef } from '@agent/core/primitives/repository/api';
import { err, ok, type Result } from '@agent/shared';
import {
  createRequestScheduler,
  createTokenBucketGate,
  requestPriorities,
  type CreateRequestSchedulerOptions,
  type RateGate,
  type RequestScheduler,
} from '@agent/shared/requests';
import { resolveInstanceRemote } from '../../../integrations/helpers/repository-remote';
import { gitLabAuthHeaders, readGitLabCredentials } from '../../../integrations/impl/gitlab/client';
import { isNetworkError } from '../../helpers/errors';
import type {
  PullRequestCheck,
  PullRequestAuthError,
  PullRequestComment,
  PullRequestError,
  PullRequestFile,
  PullRequestMergeOptions,
  PullRequestUser,
} from '../../schemas';
import type {
  Observed,
  PullRequestClient,
  PullRequestHostContext,
  PullRequestMetadata,
  PullRequestOperationErrorType,
  PullRequestPage,
  PullRequestRepositoryClient,
} from '../../types';

type User = { id: number; username: string; name?: string; avatar_url?: string; web_url?: string };
type MergeRequest = {
  iid: number;
  web_url: string;
  title: string;
  description: string | null;
  state: 'opened' | 'closed' | 'merged';
  draft?: boolean;
  created_at: string;
  updated_at: string;
  source_branch: string;
  target_branch: string;
  sha: string;
  merge_commit_sha?: string | null;
  diff_refs?: { base_sha?: string; head_sha?: string };
  source_project_id?: number | null;
  target_project_id?: number;
  author: User | null;
  assignees?: User[];
  labels?: (string | { name: string; color: string })[];
  changes_count?: string;
  merge_status?: string;
  detailed_merge_status?: string;
  head_pipeline?: { id: number; status: string; project_id?: number } | null;
};
type Diff = {
  diff: string;
  new_path: string;
  old_path: string;
  new_file?: boolean;
  deleted_file?: boolean;
  renamed_file?: boolean;
  collapsed?: boolean;
  too_large?: boolean;
};
type Approval = { approved?: boolean; approvals_required?: number; approvals_left?: number };
type Job = {
  id: number;
  name: string;
  status: string;
  web_url?: string;
  started_at?: string | null;
  finished_at?: string | null;
  stage?: string;
  allow_failure?: boolean;
};
type Note = {
  id: number;
  body: string;
  system?: boolean;
  author: User | null;
  created_at: string;
  updated_at: string;
  resolvable?: boolean;
  resolved?: boolean;
  position?: { new_path?: string; old_path?: string; new_line?: number; old_line?: number };
  web_url?: string;
};
type Discussion = { id: string; notes: Note[] };
type Page<T> = { data: T; next: string | null };
type Repository = {
  url: string;
  host: string;
  slug: string;
  projectId: number;
  instanceUrl: string;
  authHeaders: Record<string, string>;
  identity: string;
  scheduler: RequestScheduler;
  gate: RateGate;
};

export type GitLabPullRequestClientOptions = {
  fetch?: typeof fetch;
  createScheduler?: (options: CreateRequestSchedulerOptions) => RequestScheduler;
  createRateGate?: () => RateGate;
};

/** GitLab REST adapter. Inventory uses the list endpoint; detail reads fetch approvals, commits, and diffs. */
export class GitLabPullRequestClient implements PullRequestClient {
  private readonly lanes = new Map<string, { scheduler: RequestScheduler; gate: RateGate }>();

  constructor(
    private readonly host: PullRequestHostContext,
    private readonly options: GitLabPullRequestClientOptions = {}
  ) {}

  async openRepository(
    repositoryUrl: string,
    signal: AbortSignal
  ): Promise<Result<PullRequestRepositoryClient, PullRequestError>> {
    const resolved = await this.resolveRepository(repositoryUrl, signal);
    if (!resolved.success) return resolved;
    const repo = resolved.data;
    return ok({
      identity: repo.identity,
      repositoryUrl: repo.url,
      fetchOpenPage: (cursor, requestSignal, priority) =>
        this.fetchPage(repo, 'opened', cursor, requestSignal, priority),
      fetchHistoryPage: (cursor, requestSignal, priority, updatedAfter) =>
        this.fetchPage(repo, 'all', cursor, requestSignal, priority, updatedAfter),
      fetchPullRequest: (number, requestSignal, priority) =>
        this.fetchPullRequest(repo, number, requestSignal, priority),
      fetchChecks: (number, requestSignal) => this.fetchChecks(repo, number, requestSignal),
      fetchComments: (number, requestSignal) => this.fetchComments(repo, number, requestSignal),
    });
  }

  private async resolveRepository(
    repositoryUrl: string,
    signal: AbortSignal
  ): Promise<Result<Repository, PullRequestError>> {
    const parsed = parseRepositoryRef(repositoryUrl);
    if (!parsed) return err({ type: 'invalid_repository', input: repositoryUrl });
    const auth = await this.host.resolveCredentials(parsed.repositoryUrl, signal);
    if (!auth.success) return err(mapAuthError(auth.error));
    const credentials = readGitLabCredentials(auth.data.credentials);
    if (!credentials.success)
      return err({
        type: 'token_missing',
        integrationId: 'gitlab',
        host: parsed.host,
        accountId: auth.data.accountId ?? '',
        message: credentials.error.message,
      });
    const remote = resolveInstanceRemote(
      parsed.repositoryUrl,
      credentials.data.instanceUrl,
      'GitLab'
    );
    if (!remote.success) return err({ type: 'invalid_repository', input: repositoryUrl });
    const laneKey = `${parsed.host}\u0000${auth.data.accountId ?? ''}`;
    let lane = this.lanes.get(laneKey);
    if (!lane) {
      lane = {
        gate:
          this.options.createRateGate?.() ??
          createTokenBucketGate({ capacity: 34, refillPerSec: 2_000 / 60 }),
        scheduler: (this.options.createScheduler ?? createRequestScheduler)({
          scope: this.host.scope,
          maxConcurrency: 3,
          label: `gitlab:${laneKey}`,
        }),
      };
      this.lanes.set(laneKey, lane);
    }
    const repo: Repository = {
      url: parsed.repositoryUrl,
      host: parsed.host,
      slug: remote.data.slug,
      projectId: 0,
      instanceUrl: credentials.data.instanceUrl,
      authHeaders: gitLabAuthHeaders(credentials.data),
      identity: laneKey,
      ...lane,
    };
    try {
      const project = await this.request<{ id: number }>(
        repo,
        `projects/${encodeURIComponent(repo.slug)}`,
        signal,
        requestPriorities.interactive
      );
      repo.projectId = project.data.id;
      return ok(repo);
    } catch (error) {
      return err(mapError(error, repo.host, 'Unable to access GitLab project', 'refresh_failed'));
    }
  }

  private async fetchPage(
    repo: Repository,
    state: 'opened' | 'all',
    cursor: string | null,
    signal: AbortSignal,
    priority: number = requestPriorities.background,
    updatedAfter?: string
  ): Promise<Result<Observed<PullRequestPage>, PullRequestError>> {
    const fetchedAt = Date.now();
    try {
      const path = `projects/${repo.projectId}/merge_requests`;
      const query = new URLSearchParams({
        state,
        order_by: 'updated_at',
        sort: 'desc',
        per_page: '100',
        with_labels_details: 'true',
      });
      if (updatedAfter) query.set('updated_after', updatedAfter);
      const requestPath = cursor ?? `${path}?${query}`;
      const response = await this.request<MergeRequest[]>(repo, requestPath, signal, priority);
      if (!Array.isArray(response.data)) throw new Error('Invalid GitLab merge request page');
      if (response.next === requestPath)
        throw new Error('Incomplete GitLab merge request pagination');
      const sourceProjects = new Map<number, Promise<string>>();
      const prs = await Promise.all(
        response.data.map(async (mr) => {
          const metadata = mapMergeRequest(repo, mr);
          const sourceId = mr.source_project_id;
          if (sourceId != null && sourceId !== repo.projectId) {
            let source = sourceProjects.get(sourceId);
            if (!source) {
              source = this.sourceRepositoryUrl(repo, sourceId, signal, priority);
              sourceProjects.set(sourceId, source);
            }
            metadata.headRepositoryUrl = await source;
          }
          return metadata;
        })
      );
      return ok({
        fetchedAt,
        data: {
          prs,
          detailOnlyFields: [
            'baseRefOid',
            'additions',
            'deletions',
            'changedFiles',
            'commitCount',
            'reviewDecision',
            'checkSummary',
          ],
          pageInfo: { hasNextPage: !!response.next, endCursor: response.next },
        },
      });
    } catch (error) {
      return err(mapError(error, repo.host, 'Unable to list merge requests', 'sync_failed'));
    }
  }

  private async fetchPullRequest(
    repo: Repository,
    number: number,
    signal: AbortSignal,
    priority: number = requestPriorities.interactive
  ): Promise<Result<Observed<PullRequestMetadata>, PullRequestError>> {
    const fetchedAt = Date.now();
    try {
      const [mr, approvals] = await Promise.all([
        this.request<MergeRequest>(
          repo,
          `projects/${repo.projectId}/merge_requests/${number}`,
          signal,
          priority
        ),
        this.request<Approval>(
          repo,
          `projects/${repo.projectId}/merge_requests/${number}/approvals`,
          signal,
          priority
        ),
      ]);
      const [commits, diffs, source] = await Promise.all([
        this.collectPages<{ id: string }>(
          repo,
          `projects/${repo.projectId}/merge_requests/${number}/commits?per_page=100`,
          signal,
          priority
        ),
        this.collectPages<Diff>(
          repo,
          `projects/${repo.projectId}/merge_requests/${number}/diffs?per_page=100`,
          signal,
          priority
        ),
        this.sourceRepositoryUrl(repo, mr.data.source_project_id, signal, priority),
      ]);
      if (mr.data.labels?.some((label) => typeof label === 'string')) {
        const labels = await this.request<MergeRequest[]>(
          repo,
          `projects/${repo.projectId}/merge_requests?iids[]=${number}&with_labels_details=true`,
          signal,
          priority
        );
        const listed = labels.data.find((item) => item.iid === number);
        if (!listed) throw new Error('Merge request label details were not returned');
        mr.data.labels = listed.labels;
      }
      const metadata = mapMergeRequest(repo, mr.data, approvals.data);
      metadata.commitCount = commits.length;
      metadata.changedFiles = diffs.length;
      const reportedFiles = mr.data.changes_count ? Number(mr.data.changes_count) : undefined;
      const completeDiff =
        mr.data.changes_count !== '1000+' &&
        (reportedFiles === undefined || reportedFiles === diffs.length);
      metadata.changedFiles =
        reportedFiles !== undefined && Number.isFinite(reportedFiles)
          ? reportedFiles
          : completeDiff
            ? diffs.length
            : null;
      if (completeDiff && diffs.every((diff) => !diff.collapsed && !diff.too_large)) {
        metadata.additions = 0;
        metadata.deletions = 0;
        for (const file of diffs) {
          for (const line of file.diff.split('\n')) {
            if (line.startsWith('+')) metadata.additions++;
            else if (line.startsWith('-')) metadata.deletions++;
          }
        }
      }
      metadata.headRepositoryUrl = source;
      return ok({ fetchedAt, data: metadata });
    } catch (error) {
      return err(mapError(error, repo.host, 'Unable to read merge request', 'refresh_failed'));
    }
  }

  private async sourceRepositoryUrl(
    repo: Repository,
    sourceId: number | null | undefined,
    signal: AbortSignal,
    priority: number
  ): Promise<string> {
    if (sourceId === null) return '';
    if (sourceId === undefined || sourceId === repo.projectId) return repo.url;
    try {
      const project = await this.request<{ web_url: string }>(
        repo,
        `projects/${sourceId}`,
        signal,
        priority
      );
      return project.data.web_url;
    } catch (error) {
      // A readable MR may have a deleted or inaccessible source repository.
      if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        (error.status === 403 || error.status === 404)
      ) {
        signal.throwIfAborted();
        return '';
      }
      throw error;
    }
  }

  private async collectPages<T>(
    repo: Repository,
    initialPath: string,
    signal: AbortSignal,
    priority: number
  ): Promise<T[]> {
    const values: T[] = [];
    const seen = new Set<string>();
    let path: string | null = initialPath;
    while (path) {
      if (seen.has(path)) throw new Error('Incomplete GitLab pagination');
      seen.add(path);
      const page: Page<T[]> = await this.request<T[]>(repo, path, signal, priority);
      if (!Array.isArray(page.data)) throw new Error('Invalid GitLab collection');
      values.push(...page.data);
      path = page.next;
    }
    return values;
  }

  private async fetchChecks(
    repo: Repository,
    number: number,
    signal: AbortSignal
  ): Promise<
    Result<Observed<{ headRefOid: string; checks: PullRequestCheck[] }>, PullRequestError>
  > {
    const fetchedAt = Date.now();
    try {
      const mr = (
        await this.request<MergeRequest>(
          repo,
          `projects/${repo.projectId}/merge_requests/${number}`,
          signal,
          requestPriorities.interactive
        )
      ).data;
      const checks: PullRequestCheck[] = [];
      if (mr.head_pipeline) {
        let path: string | null =
          `projects/${mr.head_pipeline.project_id ?? repo.projectId}/pipelines/${mr.head_pipeline.id}/jobs?per_page=100`;
        const seen = new Set<string>();
        while (path) {
          if (seen.has(path)) throw new Error('Incomplete GitLab job pagination');
          seen.add(path);
          const page: Page<Job[]> = await this.request<Job[]>(
            repo,
            path,
            signal,
            requestPriorities.interactive
          );
          checks.push(...page.data.map((job) => mapJob(mr, job)));
          path = page.next;
        }
      }
      return ok({ fetchedAt, data: { headRefOid: mr.sha, checks } });
    } catch (error) {
      return err(mapError(error, repo.host, 'Unable to read pipeline jobs', 'checks_failed'));
    }
  }

  private async fetchComments(
    repo: Repository,
    number: number,
    signal: AbortSignal
  ): Promise<Result<Observed<PullRequestComment[]>, PullRequestError>> {
    const fetchedAt = Date.now();
    try {
      const comments: PullRequestComment[] = [];
      let path: string | null =
        `projects/${repo.projectId}/merge_requests/${number}/discussions?per_page=100`;
      const seen = new Set<string>();
      while (path) {
        if (seen.has(path)) throw new Error('Incomplete GitLab discussions pagination');
        seen.add(path);
        const page: Page<Discussion[]> = await this.request<Discussion[]>(
          repo,
          path,
          signal,
          requestPriorities.interactive
        );
        for (const discussion of page.data)
          for (const note of discussion.notes) {
            if (note.system) continue;
            comments.push({
              id: `${discussion.id}:${note.id}`,
              pullRequestUrl: `${repo.url}/-/merge_requests/${number}`,
              kind: note.position ? 'review' : 'issue',
              body: note.body,
              url: note.web_url ?? `${repo.url}/-/merge_requests/${number}#note_${note.id}`,
              author: note.author ? mapUser(note.author, repo.host) : null,
              path: note.position?.new_path ?? note.position?.old_path ?? null,
              line: note.position?.new_line ?? note.position?.old_line ?? null,
              isResolved: note.resolvable ? !!note.resolved : false,
              isOutdated: false,
              createdAt: note.created_at,
              updatedAt: note.updated_at,
            });
          }
        path = page.next;
      }
      return ok({ fetchedAt, data: comments });
    } catch (error) {
      return err(
        mapError(error, repo.host, 'Unable to read merge request discussions', 'comments_failed')
      );
    }
  }

  async createPullRequest(
    input: Parameters<PullRequestClient['createPullRequest']>[0],
    signal: AbortSignal
  ): ReturnType<PullRequestClient['createPullRequest']> {
    const target = parseRepositoryRef(input.repositoryUrl);
    const source = parseRepositoryRef(input.headRepositoryUrl ?? input.repositoryUrl);
    if (!target || !source)
      return err({
        type: 'invalid_repository',
        input: input.headRepositoryUrl ?? input.repositoryUrl,
      });
    if (target.host !== source.host)
      return err({ type: 'cross_host_pr', baseHost: target.host, headHost: source.host });
    const resolved = await this.resolveRepository(input.repositoryUrl, signal);
    if (!resolved.success) return resolved;
    const repo = resolved.data;
    try {
      const sourceRemote = resolveInstanceRemote(source.repositoryUrl, repo.instanceUrl, 'GitLab');
      if (!sourceRemote.success)
        return err({ type: 'invalid_repository', input: source.repositoryUrl });
      const sourceId =
        source.repositoryUrl === target.repositoryUrl
          ? repo.projectId
          : (
              await this.request<{ id: number }>(
                repo,
                `projects/${encodeURIComponent(sourceRemote.data.slug)}`,
                signal,
                requestPriorities.interactive
              )
            ).data.id;
      const title =
        input.draft && !isDraftTitle(input.title) ? `Draft: ${input.title}` : input.title;
      const response = await this.request<MergeRequest>(
        repo,
        `projects/${sourceId}/merge_requests`,
        signal,
        requestPriorities.interactive,
        {
          method: 'POST',
          body: {
            target_project_id: repo.projectId,
            source_branch: input.head,
            target_branch: input.base,
            title,
            description: input.body,
          },
        }
      );
      return ok({ url: response.data.web_url, number: response.data.iid });
    } catch (error) {
      return err(
        mapWriteError(error, repo.host, 'Unable to create merge request', 'create_failed')
      );
    }
  }

  async mergePullRequest(
    repositoryUrl: string,
    number: number,
    options: PullRequestMergeOptions,
    signal: AbortSignal
  ): ReturnType<PullRequestClient['mergePullRequest']> {
    const resolved = await this.resolveRepository(repositoryUrl, signal);
    if (!resolved.success) return resolved;
    const repo = resolved.data;
    if (options.bypassRequirements)
      return err({
        type: 'merge_failed',
        message: 'GitLab does not support bypassing merge requirements through this operation.',
      });
    try {
      if (options.strategy === 'rebase') {
        const project = await this.request<{ merge_method: string }>(
          repo,
          `projects/${repo.projectId}`,
          signal,
          requestPriorities.interactive
        );
        if (project.data.merge_method !== 'ff')
          return err({
            type: 'merge_failed',
            message:
              'Rebase and merge requires a GitLab project configured for fast-forward merging. Rebase the source branch before merging.',
          });
      }
      const response = await this.request<MergeRequest & { squash_commit_sha?: string | null }>(
        repo,
        `projects/${repo.projectId}/merge_requests/${number}/merge`,
        signal,
        requestPriorities.interactive,
        {
          method: 'PUT',
          body: { squash: options.strategy === 'squash', sha: options.commitHeadOid },
        }
      );
      return ok({
        sha:
          response.data.merge_commit_sha ??
          response.data.squash_commit_sha ??
          (response.data.state === 'merged' ? response.data.sha : null),
        merged: response.data.state === 'merged',
      });
    } catch (error) {
      return err(mapWriteError(error, repo.host, 'Unable to merge merge request', 'merge_failed'));
    }
  }

  async markReadyForReview(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): ReturnType<PullRequestClient['markReadyForReview']> {
    const resolved = await this.resolveRepository(repositoryUrl, signal);
    if (!resolved.success) return resolved;
    const repo = resolved.data;
    try {
      const path = `projects/${repo.projectId}/merge_requests/${number}`;
      const mr = await this.request<MergeRequest>(
        repo,
        path,
        signal,
        requestPriorities.interactive
      );
      // GitLab's update endpoint clears draft state when the draft title prefix is removed.
      const title = mr.data.title.replace(
        /^(?:(?:draft|wip):\s*|\[(?:draft|wip)\]\s*|\((?:draft|wip)\)\s*)+/i,
        ''
      );
      if (mr.data.draft && title === mr.data.title)
        return err({
          type: 'mark_ready_failed',
          message:
            'The merge request has no recognized draft title prefix. Mark it ready in GitLab.',
        });
      const updated = await this.request<MergeRequest>(
        repo,
        path,
        signal,
        requestPriorities.interactive,
        { method: 'PUT', body: { title } }
      );
      if (updated.data.draft || isDraftTitle(updated.data.title))
        return err({
          type: 'mark_ready_failed',
          message: 'GitLab still reports the merge request as draft.',
        });
      return ok();
    } catch (error) {
      return err(
        mapWriteError(error, repo.host, 'Unable to mark merge request ready', 'mark_ready_failed')
      );
    }
  }

  async getPullRequestFiles(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<PullRequestFile[], PullRequestError>> {
    const resolved = await this.resolveRepository(repositoryUrl, signal);
    if (!resolved.success) return resolved;
    const repo = resolved.data;
    try {
      const diffs = await this.collectPages<Diff>(
        repo,
        `projects/${repo.projectId}/merge_requests/${number}/diffs?per_page=100`,
        signal,
        requestPriorities.interactive
      );
      return ok(
        diffs.map((file) => ({
          filename: file.new_path ?? file.old_path,
          status: file.deleted_file
            ? 'removed'
            : file.new_file
              ? 'added'
              : file.renamed_file
                ? 'renamed'
                : 'modified',
          additions:
            file.collapsed || file.too_large
              ? null
              : file.diff.split('\n').filter((line) => line.startsWith('+')).length,
          deletions:
            file.collapsed || file.too_large
              ? null
              : file.diff.split('\n').filter((line) => line.startsWith('-')).length,
          patch: file.collapsed || file.too_large ? undefined : file.diff,
        }))
      );
    } catch (error) {
      return err(mapError(error, repo.host, 'Unable to read merge request files', 'files_failed'));
    }
  }

  private async request<T>(
    repo: Repository,
    path: string,
    signal: AbortSignal,
    priority: number,
    mutation?: { method: 'POST' | 'PUT'; body: Record<string, unknown> }
  ): Promise<Page<T>> {
    return await repo.scheduler.submit(
      {
        priority,
        key: mutation ? undefined : `${repo.identity}:${repo.slug}:${path}`,
        run: async (requestSignal) => {
          await repo.gate.acquire(1, requestSignal);
          const base = new URL(`${repo.instanceUrl.replace(/\/$/, '')}/api/v4/`);
          const url = new URL(path, base);
          if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
            throw new Error('Invalid GitLab pagination URL');
          const response = await (this.options.fetch ?? fetch)(url, {
            headers: {
              ...repo.authHeaders,
              ...(mutation ? { 'Content-Type': 'application/json' } : {}),
            },
            method: mutation?.method ?? 'GET',
            body: mutation ? JSON.stringify(mutation.body) : undefined,
            redirect: 'error',
            signal: requestSignal,
          });
          const remainingHeader = response.headers.get('ratelimit-remaining');
          const resetHeader = response.headers.get('ratelimit-reset');
          const retryAfterHeader = response.headers.get('retry-after');
          const remaining = remainingHeader === null ? undefined : Number(remainingHeader);
          const reset = resetHeader === null ? undefined : Number(resetHeader);
          const retryAfter = retryAfterHeader === null ? undefined : Number(retryAfterHeader);
          repo.gate.observe({
            remaining:
              remaining !== undefined && Number.isFinite(remaining) ? remaining : undefined,
            resetAtMs:
              reset !== undefined && Number.isFinite(reset) && reset > 0
                ? reset * 1_000
                : undefined,
            retryAfterMs:
              retryAfter !== undefined && Number.isFinite(retryAfter) && retryAfter > 0
                ? retryAfter * 1_000
                : undefined,
          });
          if (!response.ok)
            throw {
              status: response.status,
              message: `GitLab request failed (${response.status})`,
              retryAfter: response.headers.get('retry-after'),
            };
          const link = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
          const nextPage = response.headers.get('x-next-page');
          const nextUrl = link
            ? new URL(link, base)
            : nextPage
              ? new URL(
                  `${url.pathname}?${new URLSearchParams({ ...Object.fromEntries(url.searchParams), page: nextPage })}`,
                  base
                )
              : null;
          if (
            nextUrl &&
            (nextUrl.origin !== base.origin || !nextUrl.pathname.startsWith(base.pathname))
          )
            throw new Error('Invalid GitLab pagination URL');
          return {
            data: (await response.json()) as T,
            next: nextUrl
              ? `${nextUrl.pathname.slice(base.pathname.length)}${nextUrl.search}`
              : null,
          };
        },
      },
      { signal }
    );
  }
}

function mapUser(user: User, host: string): PullRequestUser {
  return {
    userId: `${host}:${user.id}`,
    userName: user.username,
    displayName: user.name ?? user.username,
    avatarUrl: user.avatar_url ?? null,
    url: user.web_url ?? null,
    userCreatedAt: null,
    userUpdatedAt: null,
  };
}

function mapMergeRequest(
  repo: Repository,
  mr: MergeRequest,
  approval?: Approval
): PullRequestMetadata {
  const status = mr.state === 'merged' ? 'merged' : mr.state === 'closed' ? 'closed' : 'open';
  const mergeStatus = mr.detailed_merge_status ?? mr.merge_status;
  return {
    url: mr.web_url,
    provider: 'gitlab',
    repositoryUrl: repo.url,
    baseRefName: mr.target_branch,
    baseRefOid: mr.diff_refs?.base_sha ?? '',
    headRepositoryUrl: mr.source_project_id === null ? '' : repo.url,
    headRefName: mr.source_branch,
    headRefOid: mr.sha,
    identifier: `!${mr.iid}`,
    title: mr.title,
    description: mr.description,
    status,
    isDraft: mr.draft ?? isDraftTitle(mr.title),
    additions: null,
    deletions: null,
    changedFiles:
      mr.changes_count && mr.changes_count !== '1000+' ? Number(mr.changes_count) : null,
    commitCount: null,
    mergeableStatus:
      mergeStatus === 'can_be_merged' || mergeStatus === 'mergeable'
        ? 'MERGEABLE'
        : mergeStatus === 'conflict'
          ? 'CONFLICTING'
          : 'UNKNOWN',
    mergeStateStatus:
      mergeStatus === 'can_be_merged' || mergeStatus === 'mergeable'
        ? 'CLEAN'
        : mergeStatus === 'conflict'
          ? 'DIRTY'
          : mergeStatus === 'need_rebase'
            ? 'BEHIND'
            : mergeStatus === 'cannot_be_merged' ||
                mergeStatus === 'ci_must_pass' ||
                mergeStatus === 'not_approved' ||
                mergeStatus === 'requested_changes' ||
                mergeStatus === 'discussions_not_resolved' ||
                mergeStatus === 'draft_status'
              ? 'BLOCKED'
              : 'UNKNOWN',
    reviewDecision: approval
      ? approval.approved
        ? 'APPROVED'
        : (approval.approvals_left ?? approval.approvals_required ?? 0) > 0
          ? 'REVIEW_REQUIRED'
          : null
      : null,
    checkSummary: mr.head_pipeline
      ? mr.head_pipeline.status === 'success'
        ? 'SUCCESS'
        : mr.head_pipeline.status === 'failed'
          ? 'FAILURE'
          : mr.head_pipeline.status === 'canceled'
            ? 'ERROR'
            : 'PENDING'
      : null,
    createdAt: mr.created_at,
    updatedAt: mr.updated_at,
    author: mr.author ? mapUser(mr.author, repo.host) : null,
    labels: (mr.labels ?? []).map((label) =>
      typeof label === 'string'
        ? { name: label, color: null }
        : { name: label.name, color: label.color.replace(/^#/, '') }
    ),
    assignees: (mr.assignees ?? []).map((user) => mapUser(user, repo.host)),
  };
}

function mapJob(mr: MergeRequest, job: Job): PullRequestCheck {
  const complete =
    ['success', 'failed', 'canceled', 'skipped'].includes(job.status) ||
    (job.status === 'manual' && job.allow_failure === true);
  return {
    id: `gitlab:${job.id}`,
    pullRequestUrl: mr.web_url,
    commitSha: mr.sha,
    name: job.name,
    status: complete
      ? 'COMPLETED'
      : job.status === 'created' || job.status === 'pending'
        ? 'QUEUED'
        : 'IN_PROGRESS',
    conclusion:
      job.status === 'success'
        ? 'SUCCESS'
        : job.status === 'failed'
          ? 'FAILURE'
          : job.status === 'canceled'
            ? 'CANCELLED'
            : job.status === 'skipped'
              ? 'SKIPPED'
              : complete
                ? 'NEUTRAL'
                : null,
    detailsUrl: job.web_url ?? null,
    startedAt: job.started_at ?? null,
    completedAt: job.finished_at ?? null,
    workflowName: job.stage ?? null,
    appName: 'GitLab CI',
    appLogoUrl: null,
  };
}

function mapAuthError(error: PullRequestAuthError): PullRequestError {
  switch (error.type) {
    case 'auth_required':
      return {
        type: 'auth_required',
        integrationId: 'gitlab',
        host: error.host,
        hint: error.hint ?? 'Connect GitLab from account settings.',
      };
    case 'account_not_found':
      return {
        type: 'account_not_found',
        integrationId: 'gitlab',
        host: error.host,
        accountId: error.accountId,
        message: error.message,
      };
    case 'account_host_mismatch':
      return {
        type: 'account_host_mismatch',
        integrationId: 'gitlab',
        host: error.host,
        accountId: error.accountId,
        accountHost: error.accountHost,
        message: error.message,
      };
    case 'token_missing':
      return {
        type: 'token_missing',
        integrationId: 'gitlab',
        host: error.host,
        accountId: error.accountId,
        message: error.message,
      };
    case 'integration_disabled':
      return { type: 'integration_disabled', integrationId: 'gitlab', message: error.message };
    case 'account_unresolvable':
      return { type: 'account_not_found', integrationId: 'gitlab', message: error.message };
  }
}

function mapError(
  error: unknown,
  host: string,
  fallback: string,
  type: PullRequestOperationErrorType
): PullRequestError {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number(error.status)
      : undefined;
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : fallback;
  if (status === 401)
    return {
      type: 'auth_required',
      integrationId: 'gitlab',
      host,
      hint: 'Connect GitLab from account settings.',
    };
  if (status === 403) return { type: 'forbidden', host, message };
  if (status === 404) return { type: 'not_found_or_no_access', host, message };
  if (status === 429) return { type: 'rate_limited', host, message };
  if (isNetworkError(error)) return { type: 'host_unreachable', host, reason: message };
  return { type, message };
}

function isDraftTitle(title: string): boolean {
  return /^(?:(?:draft|wip):|\[(?:draft|wip)\]|\((?:draft|wip)\))/i.test(title);
}

function mapWriteError(
  error: unknown,
  host: string,
  fallback: string,
  type: PullRequestOperationErrorType
): PullRequestError {
  if (typeof error === 'object' && error !== null && 'status' in error && error.status === 403) {
    return {
      type: 'auth_required',
      integrationId: 'gitlab',
      host,
      hint: 'GitLab writes require a token with the api scope and permission to change this project. Reconnect your GitLab account with an api-scoped token.',
    };
  }
  if (type === 'merge_failed' && typeof error === 'object' && error !== null && 'status' in error) {
    if (error.status === 409)
      return {
        type,
        message: 'The merge request source branch changed. Refresh MR status and try again.',
      };
    if (error.status === 405)
      return {
        type,
        message:
          'GitLab refused the merge. Check approvals, pipeline status, conflicts, and project merge settings.',
      };
  }
  return mapError(error, host, fallback, type);
}
