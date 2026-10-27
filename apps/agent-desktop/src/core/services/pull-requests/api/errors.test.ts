import { pullRequestErrorSchema as pullRequestPluginErrorSchema } from '@agent/plugins/pull-requests/schemas';
import { err } from '@agent/shared';
import { describe, expect, it } from 'vitest';
import { pullRequestsContract } from './contract';
import { pullRequestDetailsSchema, syncStateSchema } from './schemas';

const repositoryUrl = 'https://github.com/acme/repo';

describe('pull-request error boundaries', () => {
  it.each([
    {
      operation: 'refreshRepository',
      error: { type: 'remote_not_ready', status: 'disconnected' },
    },
    {
      operation: 'getPullRequestFiles',
      error: { type: 'unsupported_provider', host: 'example.com', reason: 'No PR plugin' },
    },
    { operation: 'listPullRequests', error: { type: 'list_failed', message: 'Cache unavailable' } },
    {
      operation: 'getFilterOptions',
      error: { type: 'filter_options_failed', message: 'Cache unavailable' },
    },
    {
      operation: 'getPullRequestsForHead',
      error: { type: 'task_pull_requests_failed', message: 'Cache unavailable' },
    },
    {
      operation: 'refreshPullRequest',
      error: { type: 'repository_not_registered', repositoryUrl },
    },
  ] as const)('keeps $error.type on the desktop Wire boundary', ({ operation, error }) => {
    expect(pullRequestPluginErrorSchema.safeParse(error).success).toBe(false);
    expect(pullRequestsContract[operation].output.parse(err(error))).toEqual(err(error));
  });

  it.each([
    {
      type: 'auth_required',
      integrationId: 'github',
      host: 'github.com',
      hint: 'Reconnect GitHub',
    },
    {
      type: 'rate_limited',
      host: 'github.com',
      message: 'Retry later',
      resetAt: '2026-10-14T12:00:00Z',
    },
  ])('preserves provider $type errors across the desktop boundary', (error) => {
    expect(pullRequestPluginErrorSchema.parse(error)).toEqual(error);
    expect(pullRequestsContract.refreshRepository.output.parse(err(error))).toEqual(err(error));
    const state = { phase: 'error', kind: 'repository', error };
    expect(syncStateSchema.parse(state)).toEqual(state);
  });

  it('preserves registration failures in live details and sync state', () => {
    const error = { type: 'repository_not_registered', repositoryUrl };
    const details = {
      pr: null,
      comments: [],
      commentsFetchedAt: null,
      refreshing: false,
      stale: true,
      errors: { metadata: error },
    };
    expect(pullRequestDetailsSchema.parse(details)).toEqual(details);
    const state = { phase: 'error', kind: 'repository', error };
    expect(syncStateSchema.parse(state)).toEqual(state);
  });
});
