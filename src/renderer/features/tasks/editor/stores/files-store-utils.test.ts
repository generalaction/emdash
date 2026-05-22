import { describe, expect, it } from 'vitest';
import { buildVisibleRows, makeNode, sortFileNodes } from './files-store-utils';

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
    src.children.push(makeNode('src/index.ts', 'file'));

    const rows = buildVisibleRows([src, makeNode('README.md', 'file')], new Set());

    expect(rows.map((row) => row.path)).toEqual(['src', 'README.md']);
  });

  it('reveals expanded directory children recursively', () => {
    const src = makeNode('src', 'directory');
    const components = makeNode('src/components', 'directory');
    components.children.push(makeNode('src/components/Button.tsx', 'file'));
    src.children.push(components, makeNode('src/index.ts', 'file'));

    const rows = buildVisibleRows(
      [src, makeNode('README.md', 'file')],
      new Set(['src', 'src/components'])
    );

    expect(rows.map((row) => row.path)).toEqual([
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

    expect(rows.map((row) => row.path)).toEqual(['README.md']);
  });
});
