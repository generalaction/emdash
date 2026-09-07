import type { GitChange } from '@emdash/core/runtimes/git/api';
import { describe, expect, it } from 'vitest';
import { portablePath } from '@core/primitives/desktop-runtime/api';
import { buildFileTreeGitDecorations } from './file-tree-git-decorations';

describe('buildFileTreeGitDecorations', () => {
  it('keeps the exact Git status on changed files', () => {
    const decorations = buildFileTreeGitDecorations([change('src/index.ts', 'added')]);

    expect(decorations.fileStatusByPath.get('src/index.ts')).toBe('added');
  });

  it('propagates the Git status to every ancestor directory', () => {
    const decorations = buildFileTreeGitDecorations([change('src/components/button.tsx', 'added')]);

    expect(decorations).toHaveProperty(
      'directoryStatusByPath',
      new Map([
        ['src', 'added'],
        ['src/components', 'added'],
      ])
    );
  });

  it('does not propagate deleted-only changes, matching Cursor', () => {
    const decorations = buildFileTreeGitDecorations([
      change('src/components/legacy/button.tsx', 'deleted'),
    ]);

    expect(decorations).toHaveProperty('directoryStatusByPath', new Map());
  });

  it('uses the first path with a propagated status when a directory contains mixed changes', () => {
    const decorations = buildFileTreeGitDecorations([
      change('tooling/z-new.ts', 'added'),
      change('tooling/a-existing.ts', 'modified'),
    ]);

    expect(decorations).toHaveProperty('directoryStatusByPath', new Map([['tooling', 'modified']]));
  });

  it('does not decorate a directory for a root-level change or a sibling change', () => {
    const decorations = buildFileTreeGitDecorations([
      change('README.md', 'modified'),
      change('src/components/button.tsx', 'modified'),
    ]);

    expect(decorations).toHaveProperty(
      'directoryStatusByPath',
      new Map([
        ['src', 'modified'],
        ['src/components', 'modified'],
      ])
    );
  });
});

function change(path: string, status: GitChange['status']): GitChange {
  return {
    path: portablePath(path),
    status,
    additions: status === 'deleted' ? 0 : 1,
    deletions: status === 'deleted' ? 1 : 0,
  };
}
