import { describe, expect, it } from 'vitest';
import { Branch, DefaultBranch } from '@shared/git';
import { resolveDefaultSelectedBranch } from '@renderer/core/tasks/create-task-modal/use-branch-selection';

describe('resolveDefaultSelectedBranch', () => {
  it('prefers matching local branch for the default branch', () => {
    const branches: Branch[] = [
      { type: 'remote', branch: 'main', remote: 'origin' },
      { type: 'local', branch: 'main' },
    ];
    const defaultBranch: DefaultBranch = { name: 'main', remote: 'origin', existsLocally: true };

    expect(resolveDefaultSelectedBranch(branches, defaultBranch)).toEqual({
      type: 'local',
      branch: 'main',
    });
  });

  it('falls back to matching remote branch when local does not exist', () => {
    const branches: Branch[] = [{ type: 'remote', branch: 'main', remote: 'origin' }];
    const defaultBranch: DefaultBranch = { name: 'main', remote: 'origin', existsLocally: false };

    expect(resolveDefaultSelectedBranch(branches, defaultBranch)).toEqual({
      type: 'remote',
      branch: 'main',
      remote: 'origin',
    });
  });

  it('returns undefined when the default branch does not exist locally or remotely', () => {
    const branches: Branch[] = [];
    const defaultBranch: DefaultBranch = { name: 'main', remote: 'origin', existsLocally: false };

    expect(resolveDefaultSelectedBranch(branches, defaultBranch)).toBeUndefined();
  });
});
