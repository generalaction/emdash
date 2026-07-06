import type { GitChange } from '@emdash/core/git';
import { describe, expect, it } from 'vitest';
import { buildChangesTree } from './changes-tree-utils';

describe('buildChangesTree', () => {
  it('renders workspace-relative nodes while preserving absolute change identity', () => {
    const change: GitChange = {
      path: '/repo/src/index.ts',
      status: 'modified',
      additions: 2,
      deletions: 1,
    };

    const tree = buildChangesTree([change], '/repo');

    expect(tree.rootNodes.map((node) => node.path)).toEqual(['src']);
    expect(tree.rootNodes[0]?.children[0]?.path).toBe('src/index.ts');
    expect(tree.changeByPath.get('src/index.ts')).toBe(change);
    expect(tree.changeByPath.get('src/index.ts')?.path).toBe('/repo/src/index.ts');
  });
});
