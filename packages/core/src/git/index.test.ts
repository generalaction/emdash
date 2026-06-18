import { describe, expect, it } from 'vitest';
import * as git from './index';

describe('@emdash/core/git public exports', () => {
  it('does not export concrete repository or worktree classes', () => {
    const exported = git as Record<string, unknown>;

    expect(exported.GitRuntime).toBeTypeOf('function');
    expect(exported.GitRepository).toBeUndefined();
    expect(exported.GitWorktree).toBeUndefined();
  });
});
