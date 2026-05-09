import { describe, expect, it } from 'vitest';
import { getBranchTooltipText, getPublishTooltipText } from './git-status-tooltips';

describe('git status tooltips', () => {
  it('shows initial-commit guidance for missing branch tooltip', () => {
    expect(getBranchTooltipText(undefined)).toBe('Create an initial commit first.');
  });

  it('shows initial-commit guidance for disabled publish/add-remote button when branch is missing', () => {
    expect(
      getPublishTooltipText({
        isPublishing: false,
        branchName: undefined,
        shouldOfferAddRemote: true,
      })
    ).toBe('Create an initial commit first.');
  });

  it('preserves existing publish tooltip behavior when branch exists', () => {
    expect(
      getPublishTooltipText({
        isPublishing: false,
        branchName: 'main',
        shouldOfferAddRemote: true,
      })
    ).toBe('Create or link a remote, then publish this branch');

    expect(
      getPublishTooltipText({
        isPublishing: false,
        branchName: 'main',
        shouldOfferAddRemote: false,
      })
    ).toBe('Publish branch');
  });
});
