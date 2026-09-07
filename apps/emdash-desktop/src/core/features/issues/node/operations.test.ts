import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { IssueProvider } from '@core/features/issues/api/node/issue-provider';
import { listIssues } from './operations';

function provider(): IssueProvider {
  return {
    type: 'github',
    capabilities: { requiresRepositoryUrl: true, supportsIssueContext: true },
    checkConnection: vi.fn(),
    listIssues: vi.fn(async () => ok([])),
    searchIssues: vi.fn(async () => ok([])),
  };
}

describe('issue project availability', () => {
  it('returns a typed semantic failure without calling the provider while detached', async () => {
    const issueProvider = provider();
    const requireAttached = vi.fn(() =>
      err({ type: 'project-missing' as const, projectId: 'project-1' })
    );

    await expect(
      listIssues(
        {
          projects: { requireAttached } as never,
          providers: {
            get: () => issueProvider,
            getAll: () => [issueProvider],
          },
        },
        'github',
        {
          projectId: 'project-1',
          projectPath: '/repo',
        }
      )
    ).resolves.toEqual(
      err({
        type: 'project_unavailable',
        projectId: 'project-1',
        reason: 'project-missing',
        message: 'Project runtime is unavailable for issue lookup.',
      })
    );
    expect(issueProvider.listIssues).not.toHaveBeenCalled();
  });

  it('uses durable caller identity without reading Host Git state', async () => {
    const issueProvider = provider();
    const requireAttached = vi.fn();
    const options = {
      projectId: 'project-1',
      projectPath: '/repo',
      repositoryUrl: 'https://github.com/emdash/emdash',
    };

    await listIssues(
      {
        projects: { requireAttached } as never,
        providers: {
          get: () => issueProvider,
          getAll: () => [issueProvider],
        },
      },
      'github',
      options
    );

    expect(issueProvider.listIssues).toHaveBeenCalledWith(options);
    expect(requireAttached).not.toHaveBeenCalled();
  });
});
