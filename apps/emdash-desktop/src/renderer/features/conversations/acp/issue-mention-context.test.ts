import { describe, expect, it, vi } from 'vitest';
import type { LinkedIssue } from '@shared/core/linked-issue';
import {
  buildIssueMentionHiddenContext,
  extractIssueMentionTargets,
} from './issue-mention-context';

const issue: LinkedIssue = {
  provider: 'linear',
  url: 'https://linear.app/emdash/issue/ENG-123',
  title: 'Fix issue mentions',
  identifier: 'ENG-123',
  displayIdentifier: 'ENG-123',
  description: 'Mentioned issues should be available to the agent.',
  status: 'In Progress',
};

describe('extractIssueMentionTargets', () => {
  it('extracts unique issue mention targets from bracket mentions', () => {
    expect(
      extractIssueMentionTargets(
        'Fix @[ENG-123](issue:linear:ENG-123) and again @[ENG-123](issue:linear:ENG-123)'
      )
    ).toEqual([{ token: 'issue:linear:ENG-123', provider: 'linear', identifier: 'ENG-123' }]);
  });
});

describe('buildIssueMentionHiddenContext', () => {
  it('builds hidden issue context and deduplicates repeated mentions', async () => {
    const loadIssue = vi.fn(async () => issue);

    const context = await buildIssueMentionHiddenContext(
      'Fix @[ENG-123](issue:linear:ENG-123) and @[ENG-123](issue:linear:ENG-123)',
      loadIssue
    );

    expect(loadIssue).toHaveBeenCalledTimes(1);
    expect(context).toContain('<issue_context provider="linear" identifier="ENG-123">');
    expect(context).toContain('Title: Fix issue mentions');
    expect(context).toContain('</issue_context>');
  });

  it('omits failed issue lookups', async () => {
    const context = await buildIssueMentionHiddenContext(
      'Fix @[ENG-123](issue:linear:ENG-123)',
      async () => null
    );

    expect(context).toBeUndefined();
  });
});
