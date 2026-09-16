import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshLinkedIssueContext } from '@core/features/tasks/browser/issue-context/refresh-linked-issue-context';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';

const mocks = vi.hoisted(() => ({
  getIssueContext: vi.fn(),
}));

vi.mock('@core/features/issues/api/browser/client', () => ({
  getIssuesClient: async () => ({
    getIssueContext: mocks.getIssueContext,
  }),
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
    expect(mocks.getIssueContext).toHaveBeenCalledWith({
      provider: 'github',
      options: { identifier: '#42', projectId: 'project-1' },
    });
  });

  it('returns refreshed Linear issue context', async () => {
    const issue = makeIssue();
    const refreshedIssue = makeIssue({ context: 'Linear issue activity' });
    mocks.getIssueContext.mockResolvedValue({ success: true, data: refreshedIssue });

    await expect(refreshLinkedIssueContext(issue, 'project-1')).resolves.toBe(refreshedIssue);
    expect(mocks.getIssueContext).toHaveBeenCalledWith({
      provider: 'linear',
      options: { identifier: 'ENG-1201', projectId: 'project-1' },
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

  it('keeps the original and discards a result from a different workspace (WS9 leak guard)', async () => {
    // Linked from workspace A; the project now resolves to workspace B, whose
    // same-identifier issue must never overwrite the A-linked issue.
    const issue = makeIssue({ sourceAccountId: 'linear:acme', issueId: 'uuid-acme-1201' });
    const wrongWorkspace = makeIssue({
      sourceAccountId: 'linear:beta',
      issueId: 'uuid-beta-1201',
      context: 'Beta workspace issue',
    });
    mocks.getIssueContext.mockResolvedValue({ success: true, data: wrongWorkspace });

    await expect(refreshLinkedIssueContext(issue, 'project-1')).resolves.toBe(issue);
  });

  it('keeps a legacy issue (no durable identity) when the refresh carries identity', async () => {
    // A link made before identity stamping has no sourceAccountId/issueId, so an
    // identity-bearing refresh cannot be confirmed to be the same workspace and
    // must not overwrite it (fails closed until the issue is re-linked).
    const legacyIssue = makeIssue();
    const identityBearing = makeIssue({
      sourceAccountId: 'linear:beta',
      issueId: 'uuid-beta-1201',
      context: 'Some workspace issue',
    });
    mocks.getIssueContext.mockResolvedValue({ success: true, data: identityBearing });

    await expect(refreshLinkedIssueContext(legacyIssue, 'project-1')).resolves.toBe(legacyIssue);
  });

  it('accepts a refresh from the same source workspace', async () => {
    const issue = makeIssue({ sourceAccountId: 'linear:acme', issueId: 'uuid-acme-1201' });
    const refreshedIssue = makeIssue({
      sourceAccountId: 'linear:acme',
      issueId: 'uuid-acme-1201',
      context: 'Fresh Acme context',
    });
    mocks.getIssueContext.mockResolvedValue({ success: true, data: refreshedIssue });

    await expect(refreshLinkedIssueContext(issue, 'project-1')).resolves.toBe(refreshedIssue);
  });
});
