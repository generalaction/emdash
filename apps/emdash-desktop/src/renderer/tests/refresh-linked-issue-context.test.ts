import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshLinkedIssueContext } from '@renderer/features/tasks/issue-context/refresh-linked-issue-context';
import type { LinkedIssue } from '@shared/core/linked-issue';

const mocks = vi.hoisted(() => ({
  getIssueContext: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    issues: {
      getIssueContext: mocks.getIssueContext,
    },
  },
}));

function makeIssue(overrides: Partial<LinkedIssue> = {}): LinkedIssue {
  return {
    provider: 'linear',
    identifier: 'ENG-1201',
    title: 'Paste full issue history and comments',
    url: 'https://linear.app/general-action/issue/ENG-1201',
    ...overrides,
  };
}

describe('refreshLinkedIssueContext', () => {
  beforeEach(() => {
    mocks.getIssueContext.mockReset();
  });

  it('returns the issue without fetching when no project id is given', async () => {
    const issue = makeIssue();

    await expect(refreshLinkedIssueContext(issue, undefined)).resolves.toBe(issue);
    expect(mocks.getIssueContext).not.toHaveBeenCalled();
  });

  it('refreshes context for any provider', async () => {
    const issue = makeIssue({ provider: 'github', identifier: '#42' });
    const refreshedIssue = makeIssue({
      provider: 'github',
      identifier: '#42',
      context: 'GitHub issue activity',
    });
    mocks.getIssueContext.mockResolvedValue({ success: true, data: refreshedIssue });

    await expect(refreshLinkedIssueContext(issue, 'project-1')).resolves.toBe(refreshedIssue);
    expect(mocks.getIssueContext).toHaveBeenCalledWith('github', {
      identifier: '#42',
      projectId: 'project-1',
    });
  });

  it('returns refreshed Linear issue context', async () => {
    const issue = makeIssue();
    const refreshedIssue = makeIssue({ context: 'Linear issue activity' });
    mocks.getIssueContext.mockResolvedValue({ success: true, data: refreshedIssue });

    await expect(refreshLinkedIssueContext(issue, 'project-1')).resolves.toBe(refreshedIssue);
    expect(mocks.getIssueContext).toHaveBeenCalledWith('linear', {
      identifier: 'ENG-1201',
      projectId: 'project-1',
    });
  });

  it('falls back to the original issue when refresh fails', async () => {
    const issue = makeIssue();
    mocks.getIssueContext.mockResolvedValue({
      success: false,
      error: { type: 'not_found_or_no_access', message: 'not found' },
    });

    await expect(refreshLinkedIssueContext(issue, 'project-1')).resolves.toBe(issue);
  });
});
