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

  it('returns non-Linear issues without fetching context', async () => {
    const issue = makeIssue({ provider: 'github' });

    await expect(refreshLinkedIssueContext(issue, 'project-1')).resolves.toEqual({ issue });
    expect(mocks.getIssueContext).not.toHaveBeenCalled();
  });

  it('returns refreshed Linear issue context with attachments', async () => {
    const issue = makeIssue();
    const refreshedIssue = makeIssue({ context: 'Linear issue activity' });
    const attachments = [
      {
        url: 'https://uploads.linear.app/abc/def/screenshot.png',
        localPath: '/tmp/emdash-drop-1-ENG-1201-screenshot.png',
      },
    ];
    mocks.getIssueContext.mockResolvedValue({ success: true, issue: refreshedIssue, attachments });

    await expect(refreshLinkedIssueContext(issue, 'project-1')).resolves.toEqual({
      issue: refreshedIssue,
      attachments,
    });
    expect(mocks.getIssueContext).toHaveBeenCalledWith('linear', {
      identifier: 'ENG-1201',
      projectId: 'project-1',
    });
  });

  it('falls back to the original issue when refresh fails', async () => {
    const issue = makeIssue();
    mocks.getIssueContext.mockResolvedValue({ success: false, error: 'not found' });

    await expect(refreshLinkedIssueContext(issue, 'project-1')).resolves.toEqual({ issue });
  });
});
