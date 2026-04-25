import { describe, expect, it } from 'vitest';
import type { Branch } from '@shared/git';
import { fromStoredBranch, toStoredBranch } from './stored-branch';

describe('stored-branch', () => {
  it('serializes and deserializes local branches', () => {
    const branch: Branch = { type: 'local', branch: 'main' };
    const persisted = toStoredBranch(branch);
    expect(persisted).toEqual({ type: 'local', branch: 'main' });
    expect(fromStoredBranch(persisted)).toEqual(branch);
  });

  it('serializes and deserializes remote branches', () => {
    const branch: Branch = {
      type: 'remote',
      branch: 'main',
      remote: { name: 'origin', url: 'git@github.com:owner/repo.git' },
    };
    const persisted = toStoredBranch(branch);
    expect(persisted).toEqual({
      type: 'remote',
      branch: 'main',
      remote: { name: 'origin', url: 'git@github.com:owner/repo.git' },
    });
    expect(fromStoredBranch(persisted)).toEqual(branch);
  });
});
