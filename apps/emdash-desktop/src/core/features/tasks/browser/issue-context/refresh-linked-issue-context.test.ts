import { ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import { refreshLinkedIssueContext } from './refresh-linked-issue-context';

const { getIssueContext } = vi.hoisted(() => ({ getIssueContext: vi.fn() }));
vi.mock('@core/features/issues/api/browser/client', () => ({
  getIssuesClient: async () => ({ getIssueContext }),
}));

const issue: LinkedIssue = {
  provider: 'linear',
  identifier: 'ENG-1',
  title: 'Original',
  url: 'https://linear.app/a/issue/ENG-1',
  accountId: 'workspace-a',
};

describe('linked issue source identity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the original account and URL when refreshing context', async () => {
    getIssueContext.mockResolvedValue(ok({ ...issue, context: 'Latest' }));
    await expect(refreshLinkedIssueContext(issue, 'p1')).resolves.toMatchObject({
      context: 'Latest',
    });
    expect(getIssueContext).toHaveBeenCalledWith({
      provider: 'linear',
      options: {
        projectId: 'p1',
        identifier: 'ENG-1',
        accountId: 'workspace-a',
        issueUrl: issue.url,
      },
    });
  });

  it('retains the stored snapshot on unavailable account or failed lookup', async () => {
    getIssueContext.mockResolvedValue({ success: false, error: { type: 'auth_required' } });
    await expect(refreshLinkedIssueContext(issue, 'p1')).resolves.toBe(issue);
  });

  it('does not refresh legacy issues without any durable source URL', async () => {
    const legacy = { ...issue, accountId: undefined, url: '' };
    await expect(refreshLinkedIssueContext(legacy, 'p1')).resolves.toBe(legacy);
    expect(getIssueContext).not.toHaveBeenCalled();
  });
});
