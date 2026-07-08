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

  it('keeps absolute node paths addressable when no root path is provided', () => {
    const change: GitChange = {
      path: '/repo/src/index.ts',
      status: 'modified',
      additions: 2,
      deletions: 1,
    };

    const tree = buildChangesTree([change]);
    const repo = tree.rootNodes[0];
    const src = repo?.children[0];
    const file = src?.children[0];
    const filePath = file?.path;

    expect(repo?.path).toBe('/repo');
    expect(filePath).toBe('/repo/src/index.ts');
    expect(filePath ? tree.changeByPath.get(filePath) : undefined).toBe(change);
  });
});
