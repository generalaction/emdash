import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  refreshLinkedIssueContext,
  resolveLinkedIssueContextText,
} from '@renderer/features/tasks/issue-context/refresh-linked-issue-context';
import type { Issue } from '@shared/tasks';

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

function makeIssue(overrides: Partial<Issue> = {}): Issue {
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

  it('returns non-Linear issues without fetching context', async () => {
    const issue = makeIssue({ provider: 'github' });

    await expect(refreshLinkedIssueContext(issue, 'project-1')).resolves.toBe(issue);
    expect(mocks.getIssueContext).not.toHaveBeenCalled();
  });

  it('returns refreshed Linear issue context', async () => {
    const issue = makeIssue();
    const refreshedIssue = makeIssue({ context: 'Linear issue activity' });
    mocks.getIssueContext.mockResolvedValue({ success: true, issue: refreshedIssue });

    await expect(refreshLinkedIssueContext(issue, 'project-1')).resolves.toBe(refreshedIssue);
    expect(mocks.getIssueContext).toHaveBeenCalledWith('linear', {
      identifier: 'ENG-1201',
      projectId: 'project-1',
    });
  });

  it('builds context text from refreshed Linear issue activity', async () => {
    const issue = makeIssue({ description: 'Existing fields stay present.' });
    const refreshedIssue = makeIssue({
      description: 'Existing fields stay present.',
      context: 'Linear issue activity\n\nComments:\n- 2026-04-17 by Jona: Looks good',
    });
    mocks.getIssueContext.mockResolvedValue({ success: true, issue: refreshedIssue });

    const result = await resolveLinkedIssueContextText(issue, 'project-1');

    expect(result.issue).toBe(refreshedIssue);
    expect(result.text).toContain('Provider: Linear');
    expect(result.text).toContain('Description: Existing fields stay present.');
    expect(result.text).toContain(
      'Context:\nLinear issue activity\n\nComments:\n- 2026-04-17 by Jona: Looks good'
    );
  });

  it('falls back to the original issue when refresh fails', async () => {
    const issue = makeIssue();
    mocks.getIssueContext.mockResolvedValue({ success: false, error: 'not found' });

    await expect(refreshLinkedIssueContext(issue, 'project-1')).resolves.toBe(issue);
  });
});
