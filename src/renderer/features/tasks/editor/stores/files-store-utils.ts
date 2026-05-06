// ---------------------------------------------------------------------------
// Excluded directory/file names — kept in sync with DEFAULT_TREE_EXCLUDE in
// editor-file-tree.tsx so the flat tree and renderer agree on visibility.
// ---------------------------------------------------------------------------

import { type FileNode } from '@shared/fs';

const EXCLUDED_NAMES = new Set([
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  '.turbo',
  'coverage',
  '.nyc_output',
  '.cache',
  'tmp',
  'temp',
  '.DS_Store',
  'Thumbs.db',
  '.vscode-test',
  '.idea',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'target',
  '.terraform',
  '.serverless',
  '.checkouts',
  'checkouts',
  '.conductor',
  '.cursor',
  '.claude',
  '.devin',
  '.amp',
  '.codex',
  '.aider',
  '.continue',
  '.cody',
  '.windsurf',
  'worktrees',
  '.worktrees',
  '.emdash',
  'node_modules',
]);

export function isExcluded(path: string): boolean {
  return path.split('/').some((seg) => EXCLUDED_NAMES.has(seg));
}

// ---------------------------------------------------------------------------
// Helpers for building FileNode from a raw entry path
// ---------------------------------------------------------------------------

export function makeNode(relPath: string, type: 'file' | 'directory', mtime?: Date): FileNode {
  const parts = relPath.split('/').filter(Boolean);
  const name = parts[parts.length - 1] ?? relPath;
  const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
  const depth = parts.length - 1;
  const extension = type === 'file' && name.includes('.') ? name.split('.').pop() : undefined;

  return {
    path: relPath,
    name,
    parentPath,
    depth,
    type,
    isHidden: name.startsWith('.'),
    extension,
    mtime,
  };
}

// ---------------------------------------------------------------------------
// Sorted insertion into childIndex
// Directories come before files; within each group, alphabetical order.
// ---------------------------------------------------------------------------

export function sortedChildPaths(paths: string[], nodes: Map<string, FileNode>): string[] {
  return [...paths].sort((a, b) => {
    const na = nodes.get(a);
    const nb = nodes.get(b);
    if (!na || !nb) return 0;
    if (na.type !== nb.type) return na.type === 'directory' ? -1 : 1;
    return na.name.localeCompare(nb.name);
  });
}

// ---------------------------------------------------------------------------
// Visible rows derivation
// ---------------------------------------------------------------------------

export function buildVisibleRows(
  nodes: Map<string, FileNode>,
  childIndex: Map<string | null, string[]>,
  expandedPaths: Set<string>
): FileNode[] {
  const rows: FileNode[] = [];

  function walk(parent: string | null) {
    for (const path of childIndex.get(parent) ?? []) {
      const node = nodes.get(path);
      if (!node) continue;
      rows.push(node);
      if (node.type === 'directory' && expandedPaths.has(path)) {
        walk(path);
      }
    }
  }

  walk(null);
  return rows;
}
