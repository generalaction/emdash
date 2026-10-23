import { describe, expect, it } from 'vitest';
import {
  buildNestedVisibleRows,
  makeNode,
  sortFileNodes,
  toRenderableFileNode,
  type NestedFileNode,
} from '@core/features/editor/api/browser/file-tree/tree-utils';

function attach(parent: NestedFileNode, child: NestedFileNode): NestedFileNode {
  parent.children.push(child);
  return child;
}

describe('file tree utils', () => {
  it('normalizes Windows paths into stable POSIX node identities', () => {
    const node = makeNode('src\\components\\Button.tsx', 'file');

    expect(node.path).toBe('src/components/Button.tsx');
    expect(node.name).toBe('Button.tsx');
    expect(node.parentPath).toBe('src/components');
    expect(node.depth).toBe(2);
    expect(node.children).toEqual([]);
  });

  it('preserves the leading slash for absolute parent paths', () => {
    const node = makeNode('/repo/src/Button.tsx', 'file');

    expect(node.path).toBe('/repo/src/Button.tsx');
    expect(node.parentPath).toBe('/repo/src');
  });

  it('preserves the double leading separator of UNC paths', () => {
    const node = makeNode('\\\\server\\share\\repo\\src\\Button.tsx', 'file');

    expect(node.path).toBe('//server/share/repo/src/Button.tsx');
    expect(node.parentPath).toBe('//server/share/repo/src');
  });

  it('hides loaded descendants for collapsed directories', () => {
    const src = makeNode('src', 'directory');
    attach(src, makeNode('src/index.ts', 'file'));

    const rows = buildNestedVisibleRows([src, makeNode('README.md', 'file')], new Set());

    expect(rows.map((row) => row.node.path)).toEqual(['src', 'README.md']);
  });

  it('reveals expanded directory children recursively', () => {
    const src = makeNode('src', 'directory');
    const components = makeNode('src/components', 'directory');
    attach(components, makeNode('src/components/Button.tsx', 'file'));
    attach(src, components);
    attach(src, makeNode('src/index.ts', 'file'));

    const rows = buildNestedVisibleRows(
      [src, makeNode('README.md', 'file')],
      new Set(['src', 'src/components'])
    );

    expect(rows.map((row) => row.node.path)).toEqual([
      'src',
      'src/components',
      'src/components/Button.tsx',
      'src/index.ts',
      'README.md',
    ]);
  });

  it('sorts siblings with directories first and names alphabetically', () => {
    const nodes = [
      makeNode('z-file.ts', 'file'),
      makeNode('alpha', 'directory'),
      makeNode('beta.ts', 'file'),
      makeNode('components', 'directory'),
    ];

    expect(sortFileNodes(nodes).map((node) => node.path)).toEqual([
      'alpha',
      'components',
      'beta.ts',
      'z-file.ts',
    ]);
  });

  it('sorts names in the natural order shared with the tree runtime and file tree', () => {
    const nodes = ['file10.ts', 'File2.ts', 'file1.ts'].map((name) => makeNode(name, 'file'));

    expect(sortFileNodes(nodes).map((node) => node.name)).toEqual([
      'file1.ts',
      'File2.ts',
      'file10.ts',
    ]);
  });

  it('does not render file nodes as expandable parents', () => {
    const file = makeNode('README.md', 'file');
    file.children.push(makeNode('README.md/README.md', 'file'));

    const rows = buildNestedVisibleRows([file], new Set(['README.md']));

    expect(rows.map((row) => row.node.path)).toEqual(['README.md']);
  });

  it('fuses single-child directory chains into one row', () => {
    const src = makeNode('src', 'directory');
    const components = makeNode('src/components', 'directory');
    const ui = makeNode('src/components/ui', 'directory');
    attach(components, ui);
    attach(src, components);

    const rows = buildNestedVisibleRows([src], new Set());

    expect(rows).toHaveLength(1);
    expect(rows[0].node.path).toBe('src/components/ui');
    expect(rows[0].chain.map((n) => n.name)).toEqual(['src', 'components', 'ui']);
    expect(rows[0].renderDepth).toBe(0);
  });

  it('does not fuse when a directory has a file child', () => {
    const src = makeNode('src', 'directory');
    const components = makeNode('src/components', 'directory');
    attach(src, components);
    attach(src, makeNode('src/index.ts', 'file'));

    const rows = buildNestedVisibleRows([src], new Set(['src']));

    expect(rows.map((row) => row.chain.map((n) => n.name))).toEqual([
      ['src'],
      ['components'],
      ['index.ts'],
    ]);
  });

  it('does not fuse when a directory has multiple directory children', () => {
    const src = makeNode('src', 'directory');
    attach(src, makeNode('src/components', 'directory'));
    attach(src, makeNode('src/lib', 'directory'));

    const rows = buildNestedVisibleRows([src], new Set(['src']));

    expect(rows.map((row) => row.chain.map((n) => n.name))).toEqual([
      ['src'],
      ['components'],
      ['lib'],
    ]);
  });

  it('expands the terminal segment of a fused chain', () => {
    const src = makeNode('src', 'directory');
    const components = makeNode('src/components', 'directory');
    const ui = makeNode('src/components/ui', 'directory');
    attach(ui, makeNode('src/components/ui/button.tsx', 'file'));
    attach(ui, makeNode('src/components/ui/card.tsx', 'file'));
    attach(components, ui);
    attach(src, components);

    const rows = buildNestedVisibleRows([src], new Set(['src/components/ui']));

    expect(rows.map((row) => row.node.path)).toEqual([
      'src/components/ui',
      'src/components/ui/button.tsx',
      'src/components/ui/card.tsx',
    ]);
    expect(rows[1].renderDepth).toBe(1);
    expect(rows[2].renderDepth).toBe(1);
  });

  it('stops fusing at a directory with file children', () => {
    const a = makeNode('a', 'directory');
    const b = makeNode('a/b', 'directory');
    const c = makeNode('a/b/c', 'directory');
    attach(c, makeNode('a/b/c/file.ts', 'file'));
    attach(b, c);
    attach(a, b);

    const rows = buildNestedVisibleRows([a], new Set(['a/b/c']));

    expect(rows[0].chain.map((n) => n.name)).toEqual(['a', 'b', 'c']);
    expect(rows[0].node.path).toBe('a/b/c');
    expect(rows[1].node.path).toBe('a/b/c/file.ts');
  });

  it('expands a fused chain when an intermediate segment is in expandedPaths', () => {
    const src = makeNode('src', 'directory');
    const components = makeNode('src/components', 'directory');
    const ui = makeNode('src/components/ui', 'directory');
    attach(ui, makeNode('src/components/ui/button.tsx', 'file'));
    attach(components, ui);
    attach(src, components);

    const rows = buildNestedVisibleRows([src], new Set(['src/components']));

    expect(rows.map((row) => row.node.path)).toEqual([
      'src/components/ui',
      'src/components/ui/button.tsx',
    ]);
  });

  it('terminates extendChain on a self-referential FileNode graph', () => {
    const loop = makeNode('loop', 'directory');
    loop.children.push(loop);

    const rows = buildNestedVisibleRows([loop], new Set());

    expect(rows).toHaveLength(1);
    expect(rows[0].chain).toHaveLength(1);
    expect(rows[0].node.path).toBe('loop');
  });

  it('terminates extendChain on a two-node directory cycle', () => {
    const a = makeNode('a', 'directory');
    const b = makeNode('a/b', 'directory');
    a.children.push(b);
    b.children.push(a);

    const rows = buildNestedVisibleRows([a], new Set());

    expect(rows).toHaveLength(1);
    expect(rows[0].chain.map((n) => n.path)).toEqual(['a', 'a/b']);
  });

  it('converts listed children to absolute renderer paths', () => {
    const node = toRenderableFileNode(
      { path: 'src/index.ts', name: 'index.ts', entry: { kind: 'file' } },
      '/repo'
    );

    expect(node).toMatchObject({
      id: 'src/index.ts',
      path: '/repo/src/index.ts',
      parentId: 'src',
      parentPath: '/repo/src',
      name: 'index.ts',
      type: 'file',
      extension: 'ts',
    });
  });

  it('places top-level children under the workspace and describes broken links', () => {
    const node = toRenderableFileNode(
      {
        path: 'link',
        name: 'link',
        entry: { kind: 'symlink', symlinkTarget: 'gone', symlinkTargetKind: 'missing' },
      },
      '/repo'
    );

    expect(node).toMatchObject({
      parentId: null,
      parentPath: '/repo',
      depth: 0,
      symlink: { target: 'gone', targetType: 'missing', broken: true },
    });
  });
});
