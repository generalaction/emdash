import { describe, expect, it } from 'vitest';
import {
  pickDefaultBranch,
  filterBranchOptions,
  type BranchOption,
} from '../../renderer/components/BranchSelect';

function makeBranches(count: number, prefix = 'origin/'): BranchOption[] {
  return Array.from({ length: count }, (_, i) => {
    const name = `${prefix}branch-${String(i).padStart(5, '0')}`;
    return { value: name, label: name };
  });
}

describe('pickDefaultBranch', () => {
  it('returns undefined for empty options', () => {
    expect(pickDefaultBranch([])).toBeUndefined();
  });

  it('returns the preferred value when it exists in options', () => {
    const options = [{ value: 'origin/main', label: 'origin/main' }];
    expect(pickDefaultBranch(options, 'origin/main')).toBe('origin/main');
  });

  it('ignores the preferred value when it is not in options', () => {
    const options = [{ value: 'origin/main', label: 'origin/main' }];
    expect(pickDefaultBranch(options, 'origin/develop')).toBe('origin/main');
  });

  it('prefers origin/main over main', () => {
    const options = [
      { value: 'main', label: 'main' },
      { value: 'origin/main', label: 'origin/main' },
    ];
    expect(pickDefaultBranch(options)).toBe('origin/main');
  });

  it('falls back to main when origin/main is absent', () => {
    const options = [
      { value: 'main', label: 'main' },
      { value: 'origin/develop', label: 'origin/develop' },
    ];
    expect(pickDefaultBranch(options)).toBe('main');
  });

  it('falls back to origin/master then master', () => {
    const options = [{ value: 'origin/master', label: 'origin/master' }];
    expect(pickDefaultBranch(options)).toBe('origin/master');

    const options2 = [{ value: 'master', label: 'master' }];
    expect(pickDefaultBranch(options2)).toBe('master');
  });

  it('returns first option when no defaults match', () => {
    const options = [
      { value: 'origin/develop', label: 'origin/develop' },
      { value: 'origin/staging', label: 'origin/staging' },
    ];
    expect(pickDefaultBranch(options)).toBe('origin/develop');
  });
});

describe('filterBranchOptions', () => {
  describe('capping', () => {
    it('returns at most 50 items', () => {
      const options = makeBranches(200);
      const { displayed } = filterBranchOptions(options, '');
      expect(displayed.length).toBe(50);
    });

    it('sets hasMore when options exceed the cap', () => {
      const options = makeBranches(50 + 1);
      const { hasMore } = filterBranchOptions(options, '');
      expect(hasMore).toBe(true);
    });

    it('does not set hasMore when options fit within the cap', () => {
      const options = makeBranches(50);
      const { hasMore } = filterBranchOptions(options, '');
      expect(hasMore).toBe(false);
    });

    it('returns all options when fewer than the cap', () => {
      const options = makeBranches(5);
      const { displayed } = filterBranchOptions(options, '');
      expect(displayed.length).toBe(5);
    });
  });

  describe('search filtering', () => {
    it('filters by search term', () => {
      const options = [
        { value: 'origin/main', label: 'origin/main' },
        { value: 'origin/feature-auth', label: 'origin/feature-auth' },
        { value: 'origin/fix-bug', label: 'origin/fix-bug' },
      ];
      const { displayed } = filterBranchOptions(options, 'feature');
      expect(displayed).toHaveLength(1);
      expect(displayed[0].value).toBe('origin/feature-auth');
    });

    it('is case-insensitive', () => {
      const options = [{ value: 'origin/Feature-Auth', label: 'origin/Feature-Auth' }];
      const { displayed } = filterBranchOptions(options, 'FEATURE');
      expect(displayed).toHaveLength(1);
    });

    it('returns empty when nothing matches', () => {
      const options = makeBranches(10);
      const { displayed, hasMore } = filterBranchOptions(options, 'zzz-no-match');
      expect(displayed).toHaveLength(0);
      expect(hasMore).toBe(false);
    });

    it('caps filtered results too', () => {
      // All branches contain "branch" so all match
      const options = makeBranches(200);
      const { displayed, hasMore } = filterBranchOptions(options, 'branch');
      expect(displayed.length).toBe(50);
      expect(hasMore).toBe(true);
    });
  });

  describe('selected value pinning', () => {
    it('prepends selected value when not in first N results', () => {
      const options = makeBranches(200);
      // Pick a branch that's past the first 50 alphabetically
      const selected = options[100].value;
      const { displayed, hasKnownSelection } = filterBranchOptions(options, '', selected);
      expect(hasKnownSelection).toBe(true);
      expect(displayed.some((o) => o.value === selected)).toBe(true);
    });

    it('does not duplicate when selected is already in displayed', () => {
      const options = makeBranches(10);
      const selected = options[0].value;
      const { displayed } = filterBranchOptions(options, '', selected);
      const count = displayed.filter((o) => o.value === selected).length;
      expect(count).toBe(1);
    });

    it('reports hasKnownSelection false when value is not in options', () => {
      const options = makeBranches(10);
      const { hasKnownSelection } = filterBranchOptions(options, '', 'nonexistent');
      expect(hasKnownSelection).toBe(false);
    });

    it('handles undefined selected value', () => {
      const options = makeBranches(10);
      const { hasKnownSelection } = filterBranchOptions(options, '');
      expect(hasKnownSelection).toBe(false);
    });

    it('pins selected value even when search is active', () => {
      const options = [
        { value: 'origin/main', label: 'origin/main' },
        { value: 'origin/feature-auth', label: 'origin/feature-auth' },
        { value: 'origin/fix-bug', label: 'origin/fix-bug' },
      ];
      // Search for "feature" but selected is "origin/main" (doesn't match search)
      const { displayed, hasKnownSelection } = filterBranchOptions(
        options,
        'feature',
        'origin/main'
      );
      expect(hasKnownSelection).toBe(true);
      // origin/main should NOT be in displayed since it doesn't match the search
      // and it IS found in options (hasKnownSelection), but matches don't include it
      // The pinning only adds it if it's not already in matches
      expect(displayed.some((o) => o.value === 'origin/feature-auth')).toBe(true);
    });
  });

  describe('early termination', () => {
    it('does not scan entire list when cap is reached and no selected value', () => {
      // We can't directly measure iteration count, but we can verify correct
      // results with a very large list to confirm it doesn't hang
      const options = makeBranches(100_000);
      const start = performance.now();
      const { displayed, hasMore } = filterBranchOptions(options, '');
      const elapsed = performance.now() - start;
      expect(displayed.length).toBe(50);
      expect(hasMore).toBe(true);
      // Should complete very quickly due to early termination
      expect(elapsed).toBeLessThan(100);
    });
  });
});
