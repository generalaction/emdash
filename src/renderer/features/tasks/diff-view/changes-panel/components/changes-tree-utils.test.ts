import { describe, expect, it } from 'vitest';
import type { GitChange } from '@shared/git';
import { buildChangesTree, buildDirectoryStatusByPath } from './changes-tree-utils';

function change(path: string, status: GitChange['status'] = 'modified'): GitChange {
  return { path, status, additions: 1, deletions: 0 };
}

describe('buildDirectoryStatusByPath', () => {
  it('marks every ancestor directory of a changed file', () => {
    const statuses = buildDirectoryStatusByPath([
      change('src/components/ui/button.tsx', 'modified'),
    ]);

    expect(statuses.get('src')).toBe('modified');
    expect(statuses.get('src/components')).toBe('modified');
    expect(statuses.get('src/components/ui')).toBe('modified');
    expect(statuses.has('src/components/ui/button.tsx')).toBe(false);
  });

  it('keeps the highest-priority status when descendants differ', () => {
    const statuses = buildDirectoryStatusByPath([
      change('src/added.ts', 'added'),
      change('src/lib/removed.ts', 'deleted'),
    ]);

    expect(statuses.get('src')).toBe('deleted');
    expect(statuses.get('src/lib')).toBe('deleted');
  });

  it('ignores root-level files with no parent directories', () => {
    const statuses = buildDirectoryStatusByPath([change('README.md', 'modified')]);
    expect(statuses.size).toBe(0);
  });
});

describe('buildChangesTree', () => {
  it('includes directoryStatusByPath on the built tree', () => {
    const tree = buildChangesTree([change('pkg/a.ts'), change('pkg/nested/b.ts', 'added')]);

    expect(tree.directoryStatusByPath.get('pkg')).toBe('modified');
    expect(tree.directoryStatusByPath.get('pkg/nested')).toBe('added');
    expect(tree.directoryPaths.has('pkg')).toBe(true);
    expect(tree.directoryPaths.has('pkg/nested')).toBe(true);
  });
});
