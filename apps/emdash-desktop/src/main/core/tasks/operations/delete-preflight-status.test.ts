import type { GitStatusModel } from '@emdash/core/git';
import { describe, expect, it } from 'vitest';
import { hasUncommittedStatusChanges } from './delete-preflight-status';

const cleanStatus: GitStatusModel = {
  kind: 'ok',
  staged: [],
  unstaged: [],
  stagedAdded: 0,
  stagedDeleted: 0,
};

describe('hasUncommittedStatusChanges', () => {
  it('detects staged or unstaged changes', () => {
    expect(
      hasUncommittedStatusChanges({
        ...cleanStatus,
        unstaged: [{ path: 'src/app.ts', status: 'modified', additions: 1, deletions: 0 }],
      })
    ).toBe(true);

    expect(
      hasUncommittedStatusChanges({
        ...cleanStatus,
        staged: [{ path: 'src/app.ts', status: 'modified', additions: 1, deletions: 0 }],
      })
    ).toBe(true);
  });

  it('treats clean and error statuses as not dirty', () => {
    expect(hasUncommittedStatusChanges(cleanStatus)).toBe(false);
    expect(hasUncommittedStatusChanges({ kind: 'error', message: 'git failed' })).toBe(false);
  });

  it('treats too-many-files as dirty', () => {
    expect(hasUncommittedStatusChanges({ kind: 'too-many-files' })).toBe(true);
  });
});
