import { describe, expect, it } from 'vitest';
import { changesViewModeSettingsContribution } from './settings';

describe('changesViewModeSettingsContribution', () => {
  it('defaults every section to the flat list', () => {
    expect(changesViewModeSettingsContribution.defaults).toEqual({
      unstaged: 'flat',
      staged: 'flat',
      pr: 'flat',
      commits: 'flat',
    });
  });

  it('keeps the branch commits view mode independent of the pull request files mode', () => {
    expect(
      changesViewModeSettingsContribution.schema.parse({
        unstaged: 'flat',
        staged: 'flat',
        pr: 'flat',
        commits: 'tree',
      })
    ).toEqual({ unstaged: 'flat', staged: 'flat', pr: 'flat', commits: 'tree' });
  });
});
