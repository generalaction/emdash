// ---------------------------------------------------------------------------
// Excluded directory/file names for the task editor file tree.
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
  // Split on both separators so Windows paths (`a\b\c`) are checked the same
  // as POSIX paths. Internal tree paths use `/`, but external input may not.
  return path.split(/[/\\]/).some((seg) => EXCLUDED_NAMES.has(seg));
}

// ---------------------------------------------------------------------------
// Helpers for building FileNode from a raw entry path
// ---------------------------------------------------------------------------

export function normalizeFileTreePath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).join('/');
}

export function makeNode(relPath: string, type: 'file' | 'directory', mtime?: Date): FileNode {
  const path = normalizeFileTreePath(relPath);
  const parts = path.split('/').filter(Boolean);
  const name = parts[parts.length - 1] ?? path;
  const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
  const depth = parts.length - 1;
  const extension = type === 'file' && name.includes('.') ? name.split('.').pop() : undefined;

  return {
    path,
    name,
    parentPath,
    depth,
    type,
    children: [],
    isHidden: name.startsWith('.'),
    extension,
    mtime,
  };
}

// ---------------------------------------------------------------------------
// Sibling sorting
// Directories come before files; within each group, alphabetical order.
// ---------------------------------------------------------------------------

export function sortFileNodes(nodes: readonly FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// Visible rows derivation
// ---------------------------------------------------------------------------

export interface TreeRow {
  node: FileNode;
  chain: FileNode[];
  renderDepth: number;
}

function extendChain(node: FileNode): FileNode[] {
  const chain: FileNode[] = [node];
  const visited = new Set<string>([node.path]);
  let current = node;
  while (
    current.type === 'directory' &&
    current.children.length === 1 &&
    current.children[0].type === 'directory' &&
    !visited.has(current.children[0].path)
  ) {
    current = current.children[0];
    visited.add(current.path);
    chain.push(current);
  }
  return chain;
}

export function isChainExpanded(chain: readonly FileNode[], expandedPaths: Set<string>): boolean {
  for (const segment of chain) {
    if (expandedPaths.has(segment.path)) return true;
  }
  return false;
}

export function buildVisibleRows(
  rootNodes: readonly FileNode[],
  expandedPaths: Set<string>
): TreeRow[] {
  const rows: TreeRow[] = [];

  function walk(nodes: readonly FileNode[], renderDepth: number) {
    for (const node of nodes) {
      const chain = node.type === 'directory' ? extendChain(node) : [node];
      const terminus = chain[chain.length - 1];
      rows.push({ node: terminus, chain, renderDepth });
      if (terminus.type === 'directory' && isChainExpanded(chain, expandedPaths)) {
        walk(terminus.children, renderDepth + 1);
      }
    }
  }

  walk(rootNodes, 0);
  return rows;
}
