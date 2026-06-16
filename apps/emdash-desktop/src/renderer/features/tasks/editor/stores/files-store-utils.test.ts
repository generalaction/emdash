import { describe, expect, it } from 'vitest';
import type { FileNode } from '@shared/core/fs/fs';
import { buildVisibleRows, makeNode, sortFileNodes } from './files-store-utils';

function attach(parent: FileNode, child: FileNode): FileNode {
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

  it('hides loaded descendants for collapsed directories', () => {
    const src = makeNode('src', 'directory');
    attach(src, makeNode('src/index.ts', 'file'));

    const rows = buildVisibleRows([src, makeNode('README.md', 'file')], new Set());

    expect(rows.map((row) => row.node.path)).toEqual(['src', 'README.md']);
  });

  it('reveals expanded directory children recursively', () => {
    const src = makeNode('src', 'directory');
    const components = makeNode('src/components', 'directory');
    attach(components, makeNode('src/components/Button.tsx', 'file'));
    attach(src, components);
    attach(src, makeNode('src/index.ts', 'file'));

    const rows = buildVisibleRows(
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

  it('does not render file nodes as expandable parents', () => {
    const file = makeNode('README.md', 'file');
    file.children.push(makeNode('README.md/README.md', 'file'));

    const rows = buildVisibleRows([file], new Set(['README.md']));

    expect(rows.map((row) => row.node.path)).toEqual(['README.md']);
  });

  it('fuses single-child directory chains into one row', () => {
    const src = makeNode('src', 'directory');
    const components = makeNode('src/components', 'directory');
    const ui = makeNode('src/components/ui', 'directory');
    attach(components, ui);
    attach(src, components);

    const rows = buildVisibleRows([src], new Set());

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

    const rows = buildVisibleRows([src], new Set(['src']));

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

    const rows = buildVisibleRows([src], new Set(['src']));

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

    const rows = buildVisibleRows([src], new Set(['src/components/ui']));

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

    const rows = buildVisibleRows([a], new Set(['a/b/c']));

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

    const rows = buildVisibleRows([src], new Set(['src/components']));

    expect(rows.map((row) => row.node.path)).toEqual([
      'src/components/ui',
      'src/components/ui/button.tsx',
    ]);
  });

  it('terminates extendChain on a self-referential FileNode graph', () => {
    const loop = makeNode('loop', 'directory');
    loop.children.push(loop);

    const rows = buildVisibleRows([loop], new Set());

    expect(rows).toHaveLength(1);
    expect(rows[0].chain).toHaveLength(1);
    expect(rows[0].node.path).toBe('loop');
  });

  it('terminates extendChain on a two-node directory cycle', () => {
    const a = makeNode('a', 'directory');
    const b = makeNode('a/b', 'directory');
    a.children.push(b);
    b.children.push(a);

    const rows = buildVisibleRows([a], new Set());

    expect(rows).toHaveLength(1);
    expect(rows[0].chain.map((n) => n.path)).toEqual(['a', 'a/b']);
  });
});
