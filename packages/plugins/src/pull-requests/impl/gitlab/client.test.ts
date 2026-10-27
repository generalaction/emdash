import { err, ok } from '@agent/shared';
import { createScope, type Scope } from '@agent/shared/concurrency';
import type { RateGate } from '@agent/shared/requests';
import { createStubLogger } from '@agent/shared/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationCredentials } from '../../../integrations/host';
import type { PullRequestAuthError } from '../../schemas';
import { GitLabPullRequestClient } from './client';

const url = 'https://gitlab.com/acme/platform/app';
const scopes: Scope[] = [];
afterEach(async () => {
  await Promise.all(scopes.splice(0).map((scope) => scope.dispose()));
});

const mr = {
  iid: 42,
  web_url: `${url}/-/merge_requests/42`,
  title: 'Draft: Feature',
  description: 'Description',
  state: 'opened',
  draft: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  source_branch: 'feature',
  target_branch: 'main',
  sha: 'head',
  diff_refs: { base_sha: 'base' },
  author: { id: 7, username: 'alice', name: 'Alice' },
  assignees: [{ id: 8, username: 'bob', name: 'Bob' }],
  labels: [{ name: 'bug', color: '#ff0000' }],
  head_pipeline: { id: 10, status: 'failed' },
};

function setup(
  responses: Record<string, { data: unknown; headers?: Record<string, string>; status?: number }>,
  authError?: PullRequestAuthError,
  gate?: RateGate,
  credentials: IntegrationCredentials = {
    instanceUrl: 'https://gitlab.com',
    apiToken: 'read-api-token',
  }
) {
  const scope = createScope({ label: 'gitlab-pr-test' });
  scopes.push(scope);
  const requests: URL[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const requestUrl = new URL(String(input));
    requests.push(requestUrl);
    const key = `${requestUrl.pathname}${requestUrl.search}`;
    const response =
      responses[`${_init?.method ?? 'GET'} ${key}`] ??
      responses[key] ??
      responses[requestUrl.pathname];
    if (!response) throw new Error(`Unexpected request ${key}`);
    return new Response(JSON.stringify(response.data), {
      status: response.status ?? 200,
      headers: response.headers,
    });
  });
  const { logger } = createStubLogger();
  const client = new GitLabPullRequestClient(
    {
      log: logger,
      scope,
      resolveCredentials: async () =>
        authError
          ? err(authError)
          : ok({
              accountId: 'account-1',
              credentials,
            }),
    },
    { fetch: fetcher as typeof fetch, createRateGate: gate ? () => gate : undefined }
  );
  return { client, requests, fetcher };
}

async function open(client: GitLabPullRequestClient) {
  const result = await client.openRepository(url, new AbortController().signal);
  if (!result.success) throw new Error(JSON.stringify(result.error));
  return result.data;
}

const project = { '/api/v4/projects/acme%2Fplatform%2Fapp': { data: { id: 99 } } };

describe('GitLab pull request client', () => {
  it.each([
    [
      'an access token',
      { instanceUrl: 'https://gitlab.com', apiToken: 'glpat' },
      { 'PRIVATE-TOKEN': 'glpat' },
    ],
    [
      'OAuth credentials',
      {
        instanceUrl: 'https://gitlab.com',
        accessToken: 'oauth-access',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3_600_000,
      },
      { Authorization: 'Bearer oauth-access' },
    ],
  ])('authenticates requests with %s', async (_kind, credentials, expected) => {
    const { client, fetcher } = setup(project, undefined, undefined, credentials);
    await open(client);
    const headers = (fetcher.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers).toMatchObject(expected);
    expect(Object.keys(headers)).toHaveLength(Object.keys(expected).length);
  });

  it('maps nested-project inventory and follows a pagination link', async () => {
    const first =
      '/api/v4/projects/99/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=100&with_labels_details=true';
    const next = '/api/v4/projects/99/merge_requests?cursor=next';
    const { client, requests } = setup({
      ...project,
      [first]: { data: [mr], headers: { link: `<https://gitlab.com${next}>; rel="next"` } },
      [next]: {
        data: [
          { ...mr, iid: 43, web_url: `${url}/-/merge_requests/43`, state: 'merged', draft: false },
        ],
      },
    });
    const repo = await open(client);
    const page = await repo.fetchOpenPage(null, new AbortController().signal);
    expect(page).toMatchObject({
      success: true,
      data: {
        data: {
          pageInfo: { hasNextPage: true, endCursor: 'projects/99/merge_requests?cursor=next' },
          prs: [
            {
              provider: 'gitlab',
              identifier: '!42',
              isDraft: true,
              author: { userId: 'gitlab.com:7' },
            },
          ],
        },
      },
    });
    if (!page.success) throw new Error('page failed');
    const second = await repo.fetchOpenPage(
      page.data.data.pageInfo.endCursor,
      new AbortController().signal
    );
    if (!second.success) throw new Error(JSON.stringify(second.error));
    expect(second).toMatchObject({
      success: true,
      data: { data: { prs: [{ status: 'merged' }], pageInfo: { hasNextPage: false } } },
    });
    expect(requests.some((request) => request.pathname.endsWith('/acme%2Fplatform%2Fapp'))).toBe(
      true
    );
  });

  it.each([403, 404])('keeps readable MRs when their source project returns %s', async (status) => {
    const { client } = setup({
      ...project,
      '/api/v4/projects/99/merge_requests': { data: [{ ...mr, source_project_id: 100 }] },
      '/api/v4/projects/99/merge_requests/42': { data: { ...mr, source_project_id: 100 } },
      '/api/v4/projects/99/merge_requests/42/approvals': { data: {} },
      '/api/v4/projects/99/merge_requests/42/commits': { data: [] },
      '/api/v4/projects/99/merge_requests/42/diffs': { data: [] },
      '/api/v4/projects/100': { data: {}, status },
    });
    const repo = await open(client);
    expect(await repo.fetchOpenPage(null, new AbortController().signal)).toMatchObject({
      success: true,
      data: { data: { prs: [{ headRepositoryUrl: '', identifier: '!42' }] } },
    });
    expect(await repo.fetchPullRequest(42, new AbortController().signal)).toMatchObject({
      success: true,
      data: { data: { headRepositoryUrl: '', identifier: '!42' } },
    });
  });

  it('does not associate a deleted source project with the target repository', async () => {
    const { client } = setup({
      ...project,
      '/api/v4/projects/99/merge_requests': { data: [{ ...mr, source_project_id: null }] },
      '/api/v4/projects/99/merge_requests/42': { data: { ...mr, source_project_id: null } },
      '/api/v4/projects/99/merge_requests/42/approvals': { data: {} },
      '/api/v4/projects/99/merge_requests/42/commits': { data: [] },
      '/api/v4/projects/99/merge_requests/42/diffs': { data: [] },
    });
    const repo = await open(client);
    expect(await repo.fetchOpenPage(null, new AbortController().signal)).toMatchObject({
      success: true,
      data: { data: { prs: [{ headRepositoryUrl: '' }] } },
    });
    expect(await repo.fetchPullRequest(42, new AbortController().signal)).toMatchObject({
      success: true,
      data: { data: { headRepositoryUrl: '' } },
    });
  });

  it('loads approvals, jobs, and discussions only on detail requests', async () => {
    const { client, requests } = setup({
      ...project,
      '/api/v4/projects/99/merge_requests/42': {
        data: { ...mr, detailed_merge_status: 'requested_changes' },
      },
      '/api/v4/projects/99/merge_requests/42/commits': { data: [{ id: 'head' }] },
      '/api/v4/projects/99/merge_requests/42/diffs': {
        data: [{ diff: '@@ -1 +1 @@\n-old\n+new\n+extra' }],
      },
      '/api/v4/projects/99/merge_requests/42/approvals': {
        data: { approved: false, approvals_left: 1 },
      },
      '/api/v4/projects/99/pipelines/10/jobs': {
        data: [{ id: 123, name: 'build', status: 'failed', web_url: 'https://gitlab.com/job/123' }],
      },
      '/api/v4/projects/99/merge_requests/42/discussions': {
        data: [
          {
            id: 'thread',
            notes: [
              {
                id: 5,
                body: 'Please fix',
                author: mr.author,
                created_at: mr.created_at,
                updated_at: mr.updated_at,
                position: { new_path: 'src/app.ts', new_line: 3 },
                resolvable: true,
                resolved: false,
              },
            ],
          },
        ],
      },
    });
    const repo = await open(client);
    expect(requests).toHaveLength(1);
    expect(await repo.fetchPullRequest(42, new AbortController().signal)).toMatchObject({
      success: true,
      data: {
        data: {
          reviewDecision: 'REVIEW_REQUIRED',
          mergeStateStatus: 'BLOCKED',
          commitCount: 1,
          changedFiles: 1,
          additions: 2,
          deletions: 1,
          labels: [{ name: 'bug', color: 'ff0000' }],
          assignees: [{ userId: 'gitlab.com:8' }],
        },
      },
    });
    expect(await repo.fetchChecks(42, new AbortController().signal)).toMatchObject({
      success: true,
      data: {
        data: {
          headRefOid: 'head',
          checks: [{ id: 'gitlab:123', status: 'COMPLETED', conclusion: 'FAILURE' }],
        },
      },
    });
    expect(await repo.fetchComments(42, new AbortController().signal)).toMatchObject({
      success: true,
      data: { data: [{ id: 'thread:5', kind: 'review', path: 'src/app.ts', line: 3 }] },
    });
  });

  it('rejects redirects and cross-host credential endpoints', async () => {
    const redirect = setup({
      '/api/v4/projects/acme%2Fplatform%2Fapp': {
        data: {},
        status: 302,
        headers: { location: 'https://other.example/project' },
      },
    });
    expect(await redirect.client.openRepository(url, new AbortController().signal)).toMatchObject({
      success: false,
    });
    expect(redirect.fetcher.mock.calls[0]?.[1]?.redirect).toBe('error');
    const mismatch = setup(project, undefined, undefined, {
      instanceUrl: 'https://other.example',
      apiToken: 'token',
    });
    expect(await mismatch.client.openRepository(url, new AbortController().signal)).toMatchObject({
      success: false,
    });
    expect(mismatch.fetcher).not.toHaveBeenCalled();
  });

  it('rejects pagination links outside the credential endpoint', async () => {
    const { client } = setup({
      ...project,
      '/api/v4/projects/99/merge_requests': {
        data: [mr],
        headers: {
          link: '<https://other.example/api/v4/merge_requests>; rel="next"',
        },
      },
    });
    const repo = await open(client);
    expect(await repo.fetchOpenPage(null, new AbortController().signal)).toMatchObject({
      success: false,
      error: { type: 'sync_failed' },
    });
  });

  it('resolves fork identities once per source project during inventory', async () => {
    const forkUrl = 'https://gitlab.com/acme/forks/app';
    const { client, requests } = setup({
      ...project,
      '/api/v4/projects/100': { data: { web_url: forkUrl } },
      '/api/v4/projects/99/merge_requests': {
        data: [
          { ...mr, source_project_id: 100 },
          { ...mr, iid: 43, source_project_id: 100 },
        ],
      },
    });
    const repo = await open(client);
    expect(await repo.fetchOpenPage(null, new AbortController().signal)).toMatchObject({
      success: true,
      data: { data: { prs: [{ headRepositoryUrl: forkUrl }, { headRepositoryUrl: forkUrl }] } },
    });
    expect(requests.filter((request) => request.pathname === '/api/v4/projects/100')).toHaveLength(
      1
    );
    expect(requests.some((request) => /merge_requests\/\d/.test(request.pathname))).toBe(false);
  });

  it('fetches label colors when the single-MR response contains only label names', async () => {
    const { client } = setup({
      ...project,
      '/api/v4/projects/99/merge_requests/42': { data: { ...mr, labels: ['bug'] } },
      '/api/v4/projects/99/merge_requests/42/approvals': { data: { approved: true } },
      '/api/v4/projects/99/merge_requests/42/commits': { data: [] },
      '/api/v4/projects/99/merge_requests/42/diffs': { data: [] },
      '/api/v4/projects/99/merge_requests?iids[]=42&with_labels_details=true': { data: [mr] },
    });
    const repo = await open(client);
    expect(await repo.fetchPullRequest(42, new AbortController().signal)).toMatchObject({
      success: true,
      data: { data: { labels: [{ name: 'bug', color: 'ff0000' }], reviewDecision: 'APPROVED' } },
    });
  });

  it('does not report complete diff counts when GitLab truncates a diff', async () => {
    const { client } = setup({
      ...project,
      '/api/v4/projects/99/merge_requests/42': { data: { ...mr, changes_count: '1000+' } },
      '/api/v4/projects/99/merge_requests/42/approvals': { data: {} },
      '/api/v4/projects/99/merge_requests/42/commits': { data: [] },
      '/api/v4/projects/99/merge_requests/42/diffs': {
        data: [{ diff: '+partial', too_large: true }],
      },
    });
    const repo = await open(client);
    expect(await repo.fetchPullRequest(42, new AbortController().signal)).toMatchObject({
      success: true,
      data: { data: { additions: null, deletions: null, changedFiles: null } },
    });
  });

  it('uses the pipeline project and keeps blocking manual jobs pending', async () => {
    const { client } = setup({
      ...project,
      '/api/v4/projects/99/merge_requests/42': {
        data: { ...mr, head_pipeline: { id: 10, status: 'manual', project_id: 100 } },
      },
      '/api/v4/projects/100/pipelines/10/jobs': {
        data: [
          { id: 1, name: 'deploy', status: 'manual', allow_failure: false },
          { id: 2, name: 'optional', status: 'manual', allow_failure: true },
        ],
      },
    });
    const repo = await open(client);
    expect(await repo.fetchChecks(42, new AbortController().signal)).toMatchObject({
      success: true,
      data: {
        data: {
          headRefOid: 'head',
          checks: [
            { name: 'deploy', status: 'IN_PROGRESS', conclusion: null },
            { name: 'optional', status: 'COMPLETED', conclusion: 'NEUTRAL' },
          ],
        },
      },
    });
  });

  it('creates draft merge requests from a nested fork into the target project', async () => {
    const { client, fetcher } = setup({
      ...project,
      '/api/v4/projects/acme%2Fforks%2Fapp': { data: { id: 100 } },
      'POST /api/v4/projects/100/merge_requests': { data: mr },
    });
    expect(
      await client.createPullRequest(
        {
          repositoryUrl: url,
          headRepositoryUrl: 'https://gitlab.com/acme/forks/app',
          head: 'feature',
          base: 'main',
          title: 'Feature',
          body: 'Description',
          draft: true,
        },
        new AbortController().signal
      )
    ).toEqual(ok({ url: mr.web_url, number: 42 }));
    const write = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(write?.[1]?.body))).toEqual({
      target_project_id: 99,
      source_branch: 'feature',
      target_branch: 'main',
      title: 'Draft: Feature',
      description: 'Description',
    });
  });

  it('rejects cross-host creation before accessing credentials or sending requests', async () => {
    const { client, fetcher } = setup(project);
    expect(
      await client.createPullRequest(
        {
          repositoryUrl: url,
          headRepositoryUrl: 'https://elsewhere.example/group/app',
          head: 'feature',
          base: 'main',
          title: 'Feature',
          draft: false,
        },
        new AbortController().signal
      )
    ).toMatchObject({ success: false, error: { type: 'cross_host_pr' } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['merge', 'squash', 'rebase'] as const)(
    'merges with %s and an expected head SHA',
    async (strategy) => {
      const { client, fetcher } = setup({
        ...project,
        '/api/v4/projects/99': { data: { merge_method: 'ff' } },
        'PUT /api/v4/projects/99/merge_requests/42/merge': {
          data: { ...mr, state: 'merged', merge_commit_sha: 'merged' },
        },
      });
      expect(
        await client.mergePullRequest(
          url,
          42,
          { strategy, commitHeadOid: 'head' },
          new AbortController().signal
        )
      ).toEqual(ok({ sha: 'merged', merged: true }));
      const write = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(JSON.parse(String(write?.[1]?.body))).toEqual({
        squash: strategy === 'squash',
        sha: 'head',
      });
    }
  );

  it('refuses rebase-only merging on merge-commit projects and refuses bypass', async () => {
    const { client, fetcher } = setup({
      ...project,
      '/api/v4/projects/99': { data: { merge_method: 'merge' } },
    });
    for (const options of [
      { strategy: 'rebase' as const },
      { strategy: 'merge' as const, bypassRequirements: true },
    ]) {
      expect(
        await client.mergePullRequest(url, 42, options, new AbortController().signal)
      ).toMatchObject({ success: false, error: { type: 'merge_failed' } });
    }
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('clears the draft title prefix and verifies the returned draft state', async () => {
    const { client, fetcher } = setup({
      ...project,
      'GET /api/v4/projects/99/merge_requests/42': { data: mr },
      'PUT /api/v4/projects/99/merge_requests/42': {
        data: { ...mr, title: 'Feature', draft: false },
      },
    });
    expect(await client.markReadyForReview(url, 42, new AbortController().signal)).toEqual(ok());
    const write = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(write?.[1]?.body))).toEqual({ title: 'Feature' });
  });

  it('reports a failed mark-ready when GitLab still returns draft state', async () => {
    const { client } = setup({ ...project, '/api/v4/projects/99/merge_requests/42': { data: mr } });
    expect(await client.markReadyForReview(url, 42, new AbortController().signal)).toMatchObject({
      success: false,
      error: { type: 'mark_ready_failed' },
    });
  });

  it.each(['create', 'merge', 'ready'] as const)(
    'maps forbidden %s writes to actionable scope help',
    async (operation) => {
      const { client } = setup({
        ...project,
        '/api/v4/projects/99/merge_requests/42': { data: mr },
        'PUT /api/v4/projects/99/merge_requests/42': { data: {}, status: 403 },
        'PUT /api/v4/projects/99/merge_requests/42/merge': { data: {}, status: 403 },
        'POST /api/v4/projects/99/merge_requests': { data: {}, status: 403 },
      });
      const signal = new AbortController().signal;
      const result =
        operation === 'create'
          ? await client.createPullRequest(
              { repositoryUrl: url, head: 'feature', base: 'main', title: 'Feature', draft: false },
              signal
            )
          : operation === 'merge'
            ? await client.mergePullRequest(url, 42, { strategy: 'merge' }, signal)
            : await client.markReadyForReview(url, 42, signal);
      expect(result).toMatchObject({
        success: false,
        error: {
          type: 'auth_required',
          integrationId: 'gitlab',
          hint: expect.stringContaining('api scope'),
        },
      });
    }
  );

  it('keeps omitted file diff counts unknown', async () => {
    const { client } = setup({
      ...project,
      '/api/v4/projects/99/merge_requests/42/diffs': {
        data: [{ new_path: 'large.ts', old_path: 'large.ts', diff: '', too_large: true }],
      },
    });
    expect(await client.getPullRequestFiles(url, 42, new AbortController().signal)).toEqual(
      ok([
        {
          filename: 'large.ts',
          status: 'modified',
          additions: null,
          deletions: null,
          patch: undefined,
        },
      ])
    );
  });

  it('reports a stale head failure without retrying the merge', async () => {
    const { client, fetcher } = setup({
      ...project,
      'PUT /api/v4/projects/99/merge_requests/42/merge': { data: {}, status: 409 },
    });
    expect(
      await client.mergePullRequest(
        url,
        42,
        { strategy: 'merge', commitHeadOid: 'old-head' },
        new AbortController().signal
      )
    ).toMatchObject({
      success: false,
      error: { type: 'merge_failed', message: expect.stringContaining('source branch changed') },
    });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  });

  it('maps paginated file diffs and preserves patches', async () => {
    const { client } = setup({
      ...project,
      '/api/v4/projects/99/merge_requests/42/diffs': {
        data: [
          {
            new_path: 'new.ts',
            old_path: 'old.ts',
            renamed_file: true,
            diff: '@@ -1 +1 @@\n-old\n+new',
          },
        ],
        headers: { 'x-next-page': '2' },
      },
      '/api/v4/projects/99/merge_requests/42/diffs?per_page=100&page=2': {
        data: [{ new_path: 'gone.ts', old_path: 'gone.ts', deleted_file: true, diff: '-gone' }],
      },
    });
    expect(await client.getPullRequestFiles(url, 42, new AbortController().signal)).toMatchObject({
      success: true,
      data: [
        {
          filename: 'new.ts',
          status: 'renamed',
          additions: 1,
          deletions: 1,
          patch: expect.stringContaining('+new'),
        },
        { filename: 'gone.ts', status: 'removed' },
      ],
    });
  });

  it('sends the incremental boundary to GitLab', async () => {
    const boundary = '2026-01-01T00:00:00Z';
    const { client, requests } = setup({
      ...project,
      '/api/v4/projects/99/merge_requests': { data: [] },
    });
    const repo = await open(client);
    expect(
      await repo.fetchHistoryPage(null, new AbortController().signal, undefined, boundary)
    ).toMatchObject({ success: true });
    expect(requests[1]?.searchParams.get('updated_after')).toBe(boundary);
  });

  it('fails closed for malformed credentials and maps API authorization errors', async () => {
    const { client, fetcher } = setup(project, {
      type: 'account_unresolvable',
      host: 'gitlab.com',
      message: 'No account',
    });
    expect(await client.openRepository(url, new AbortController().signal)).toMatchObject({
      success: false,
      error: { type: 'account_not_found', integrationId: 'gitlab' },
    });
    expect(fetcher).not.toHaveBeenCalled();
    const malformed = setup(project, undefined, undefined, { instanceUrl: 'https://gitlab.com' });
    expect(await malformed.client.openRepository(url, new AbortController().signal)).toMatchObject({
      success: false,
      error: { type: 'token_missing', integrationId: 'gitlab' },
    });
    expect(malformed.fetcher).not.toHaveBeenCalled();
    const denied = setup({ '/api/v4/projects/acme%2Fplatform%2Fapp': { data: {}, status: 401 } });
    expect(await denied.client.openRepository(url, new AbortController().signal)).toMatchObject({
      success: false,
      error: { type: 'auth_required', integrationId: 'gitlab' },
    });
  });

  it('feeds GitLab response limits to its own rate gate', async () => {
    const gate: RateGate = { acquire: vi.fn(async () => {}), observe: vi.fn() };
    const { client } = setup(
      {
        '/api/v4/projects/acme%2Fplatform%2Fapp': {
          data: { id: 99 },
          headers: { 'ratelimit-remaining': '100', 'ratelimit-reset': '200' },
        },
      },
      undefined,
      gate
    );
    await open(client);
    expect(gate.acquire).toHaveBeenCalledWith(1, expect.any(AbortSignal));
    expect(gate.observe).toHaveBeenCalledWith({
      remaining: 100,
      resetAtMs: 200_000,
      retryAfterMs: undefined,
    });
  });

  it.each([
    [403, 'forbidden'],
    [404, 'not_found_or_no_access'],
    [429, 'rate_limited'],
  ])('maps GitLab HTTP %s to %s', async (status, type) => {
    const { client } = setup({
      '/api/v4/projects/acme%2Fplatform%2Fapp': { data: {}, status },
    });
    expect(await client.openRepository(url, new AbortController().signal)).toMatchObject({
      success: false,
      error: { type },
    });
  });
});
