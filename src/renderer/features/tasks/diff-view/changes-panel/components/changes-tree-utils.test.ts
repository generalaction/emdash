import { describe, expect, it } from 'vitest';
import type { GitChange } from '@shared/git';
import { buildChangesTree, buildDirectoryStatusByPath } from './changes-tree-utils';

function change(path: string, status: GitChange['status'] = 'modified'): GitChange {
  return { path, status, additions: 1, deletions: 0 };
}

const ADJACENT_STATUS_PAIRS: [GitChange['status'], GitChange['status']][] = [
  ['conflicted', 'deleted'],
  ['deleted', 'modified'],
  ['modified', 'renamed'],
  ['renamed', 'added'],
];

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

  it.each(ADJACENT_STATUS_PAIRS)(
    'prefers %s over %s on a shared parent directory',
    (higher, lower) => {
      const statuses = buildDirectoryStatusByPath([
        change(`src/${lower}.ts`, lower),
        change(`src/${higher}.ts`, higher),
      ]);
      expect(statuses.get('src')).toBe(higher);
    }
  );

  it('does not promote status to sibling-only directories', () => {
    const statuses = buildDirectoryStatusByPath([
      change('src/lib/removed.ts', 'deleted'),
      change('src/components/button.tsx', 'added'),
    ]);
    expect(statuses.get('src/lib')).toBe('deleted');
    expect(statuses.get('src/components')).toBe('added');
    expect(statuses.get('src')).toBe('deleted');
    expect(statuses.has('src/other')).toBe(false);
    expect(statuses.size).toBe(3);
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
