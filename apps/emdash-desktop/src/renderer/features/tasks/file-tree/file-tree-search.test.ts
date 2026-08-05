import { describe, expect, it } from 'vitest';
import type { WorkspaceFileHit } from '@shared/core/search';
import {
  getNextFileTreeMatchIndex,
  toFileTreeMatches,
  type FileTreeSearchMatch,
} from './file-tree-search';

describe('file-tree-search', () => {
  it('cycles forward and backward through matches', () => {
    const matches: FileTreeSearchMatch[] = [
      { path: '/root/a.ts' },
      { path: '/root/b.ts' },
      { path: '/root/c.ts' },
    ];

    expect(getNextFileTreeMatchIndex(matches, -1, 'next')).toBe(0);
    expect(getNextFileTreeMatchIndex(matches, -1, 'prev')).toBe(2);
    expect(getNextFileTreeMatchIndex(matches, 0, 'next')).toBe(1);
    expect(getNextFileTreeMatchIndex(matches, 0, 'prev')).toBe(2);
    expect(getNextFileTreeMatchIndex(matches, 2, 'next')).toBe(0);
  });

  it('returns -1 for no matches', () => {
    expect(getNextFileTreeMatchIndex([], -1, 'next')).toBe(-1);
  });
});

describe('toFileTreeMatches', () => {
  it('passes hit.path through unchanged as an absolute path', () => {
    // Regression guard: hit.path must stay absolute so it lines up with
    // FilesStore's node.path (see FilesStore.resolveWorkspacePath). Converting
    // it to a workspace-relative path here previously broke isCurrentMatch,
    // since row.node.path is always absolute — the search still reported the
    // right match count, but the highlight/scroll silently pointed at nothing.
    const hits: WorkspaceFileHit[] = [{ path: '/repo/src/index.ts', filename: 'index.ts' }];

    expect(toFileTreeMatches(hits)).toEqual([{ path: '/repo/src/index.ts' }]);
  });

  it('sorts matches by absolute path', () => {
    const hits: WorkspaceFileHit[] = [
      { path: '/repo/src/z.ts', filename: 'z.ts' },
      { path: '/repo/src/a.ts', filename: 'a.ts' },
      { path: '/repo/README.md', filename: 'README.md' },
    ];

    expect(toFileTreeMatches(hits)).toEqual([
      { path: '/repo/README.md' },
      { path: '/repo/src/a.ts' },
      { path: '/repo/src/z.ts' },
    ]);
  });

  it('returns an empty array for no hits', () => {
    expect(toFileTreeMatches([])).toEqual([]);
  });
});
