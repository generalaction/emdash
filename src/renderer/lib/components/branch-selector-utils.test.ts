import { describe, expect, it } from 'vitest';
import type { Branch } from '@shared/git';
import { filterBranchesForPicker } from './branch-selector-utils';

const origin = { name: 'origin', url: 'git@github.com:example/repo.git' };
const upstream = { name: 'upstream', url: 'git@github.com:example/upstream.git' };

const branches: Branch[] = [
  { type: 'local', branch: 'main' },
  { type: 'local', branch: 'feature/local' },
  { type: 'remote', branch: 'main', remote: origin },
  { type: 'remote', branch: 'feature/origin', remote: origin },
  { type: 'remote', branch: 'main', remote: upstream },
  { type: 'remote', branch: 'feature/upstream', remote: upstream },
];

describe('filterBranchesForPicker', () => {
  it('returns local branches without applying a remote filter', () => {
    expect(filterBranchesForPicker(branches, 'local', 'upstream')).toEqual([
      { type: 'local', branch: 'main' },
      { type: 'local', branch: 'feature/local' },
    ]);
  });

  it('filters remote branches to the selected remote', () => {
    expect(filterBranchesForPicker(branches, 'remote', 'upstream')).toEqual([
      { type: 'remote', branch: 'main', remote: upstream },
      { type: 'remote', branch: 'feature/upstream', remote: upstream },
    ]);
  });

  it('keeps all remote branches when no remote filter is provided', () => {
    expect(filterBranchesForPicker(branches, 'remote')).toEqual([
      { type: 'remote', branch: 'main', remote: origin },
      { type: 'remote', branch: 'feature/origin', remote: origin },
      { type: 'remote', branch: 'main', remote: upstream },
      { type: 'remote', branch: 'feature/upstream', remote: upstream },
    ]);
  });
});
