import { describe, expect, expectTypeOf, it } from 'vitest';
import { formatIssueAsPrompt, type Issue } from './tasks';

describe('Issue', () => {
  it('supports provider-specific branch names', () => {
    const issue: Issue = {
      provider: 'linear',
      url: 'https://linear.app/general-action/issue/GEN-626',
      title: 'Linear issue branch name creation',
      identifier: 'GEN-626',
      branchName: 'jona/gen-626-linear-issue-branch-name-creation',
    };

    expect(issue.branchName).toBe('jona/gen-626-linear-issue-branch-name-creation');
    expectTypeOf(issue.branchName).toEqualTypeOf<string | undefined>();
  });

  it('includes provider-specific context in issue prompts', () => {
    const issue: Issue = {
      provider: 'linear',
      url: 'https://linear.app/general-action/issue/GEN-626',
      title: 'Linear issue branch name creation',
      identifier: 'GEN-626',
      description: 'Use the Linear branch format',
      context: 'Linear issue activity\n\nComments:\n- 2026-04-17 by Jona: Looks good',
    };

    expect(formatIssueAsPrompt(issue)).toContain('Linear issue activity');
    expect(formatIssueAsPrompt(issue)).toContain('Looks good');
  });
});
