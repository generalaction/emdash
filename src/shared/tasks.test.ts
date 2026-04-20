import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Issue } from './tasks';

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
});
