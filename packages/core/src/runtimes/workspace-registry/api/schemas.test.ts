import { describe, expect, it } from 'vitest';
import { createWorktreeInputSchema } from './schemas';

// Host-side validation of the createWorktree contract: baseRef is required unless
// gitSetup.fetchBranch materializes the branch instead (spec: pr-workspace-model
// provisioning). Callers never pass raw refspecs or config keys — the structured
// gitSetup block is the only crossing.

const base = {
  workspaceId: 'ws-1',
  repositoryId: 'repo-1',
  branch: 'pr/7/fix',
  path: '/tmp/wt',
};

describe('createWorktreeInputSchema', () => {
  it('accepts a plain baseRef input and applies defaults', () => {
    const parsed = createWorktreeInputSchema.parse({ ...base, baseRef: 'main' });
    expect(parsed).toEqual({
      ...base,
      baseRef: 'main',
      preservePatterns: [],
      pushBranch: false,
    });
  });

  it('accepts an omitted baseRef when gitSetup.fetchBranch is present', () => {
    const parsed = createWorktreeInputSchema.parse({
      ...base,
      gitSetup: {
        fetchBranch: { remote: 'origin', sourceRef: 'refs/pull/7/head' },
        upstream: { remote: 'origin', mergeRef: 'refs/pull/7/head' },
        breadcrumb: { prUrl: 'https://github.com/acme/repo/pull/7' },
        followRef: true,
      },
    });
    expect(parsed.baseRef).toBeUndefined();
    expect(parsed.gitSetup?.followRef).toBe(true);
  });

  it('rejects an input with neither baseRef nor gitSetup.fetchBranch', () => {
    const result = createWorktreeInputSchema.safeParse({ ...base });
    expect(result.success).toBe(false);
  });

  it('rejects a gitSetup without fetchBranch when baseRef is also omitted', () => {
    const result = createWorktreeInputSchema.safeParse({
      ...base,
      gitSetup: { breadcrumb: { prUrl: 'https://github.com/acme/repo/pull/7' } },
    });
    expect(result.success).toBe(false);
  });
});
