import { describe, expect, it } from 'vitest';
import { HEAD_REF, STAGED_REF, type GitRef } from '@shared/core/git/types';
import { commitRef, refsEqual } from '@shared/core/git/utils';
import { invalidateWorktreeGitModels } from './git-model-invalidation';
import type { MonacoModelRegistry } from './monaco-model-registry';

/** Minimal registry whose findGitUris matches by ref like the real one (via refsEqual). */
function makeRegistry(entries: Array<{ ref: GitRef; uri: string }>) {
  const invalidated: string[] = [];
  const registry = {
    findGitUris: ({ ref }: { ref?: GitRef }) =>
      entries.filter((e) => ref !== undefined && refsEqual(e.ref, ref)).map((e) => e.uri),
    invalidateModel: (uri: string) => {
      invalidated.push(uri);
      return Promise.resolve();
    },
  } as unknown as MonacoModelRegistry;
  return { registry, invalidated };
}

describe('invalidateWorktreeGitModels', () => {
  it('invalidates both the head DiffMode and the commit-HEAD models on a head update (#2576)', () => {
    const { registry, invalidated } = makeRegistry([
      { ref: HEAD_REF, uri: 'git://ws/HEAD/a.ts' },
      { ref: commitRef('HEAD'), uri: 'git://ws/HEAD/b.ts' },
      { ref: STAGED_REF, uri: 'git://ws/STAGED/c.ts' },
    ]);

    invalidateWorktreeGitModels(registry, 'ws', 'head');

    // The commit-HEAD model (b.ts) is the one that used to go stale after a branch switch.
    expect(invalidated.sort()).toEqual(['git://ws/HEAD/a.ts', 'git://ws/HEAD/b.ts']);
  });

  it('invalidates only the staged models on a status update', () => {
    const { registry, invalidated } = makeRegistry([
      { ref: HEAD_REF, uri: 'git://ws/HEAD/a.ts' },
      { ref: commitRef('HEAD'), uri: 'git://ws/HEAD/b.ts' },
      { ref: STAGED_REF, uri: 'git://ws/STAGED/c.ts' },
    ]);

    invalidateWorktreeGitModels(registry, 'ws', 'status');

    expect(invalidated).toEqual(['git://ws/STAGED/c.ts']);
  });

  it('de-duplicates a uri matched by more than one HEAD representation', () => {
    const { registry, invalidated } = makeRegistry([
      { ref: HEAD_REF, uri: 'git://ws/HEAD/a.ts' },
      { ref: commitRef('HEAD'), uri: 'git://ws/HEAD/a.ts' },
    ]);

    invalidateWorktreeGitModels(registry, 'ws', 'head');

    expect(invalidated).toEqual(['git://ws/HEAD/a.ts']);
  });
});
