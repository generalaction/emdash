import type {
  DirectoryPreviewSegment,
  FileNode as CoreFileNode,
  FileSymlinkInfo,
  FileNodeType,
  NodeId,
} from '@emdash/core/files';

export interface RenderableFileNode {
  id: NodeId;
  path: string;
  name: string;
  parentId: NodeId | null;
  parentPath: string | null;
  depth: number;
  type: FileNodeType;
  symlink?: FileSymlinkInfo;
  childrenLoaded: boolean;
  isHidden: boolean;
  extension?: string;
  directoryPreview?: {
    childCount: number;
    singleChildDirectoryChain: DirectoryPreviewSegment[];
  };
}

export interface NestedFileNode {
  path: string;
  name: string;
  parentPath: string | null;
  depth: number;
  type: 'file' | 'directory';
  children: NestedFileNode[];
  isHidden: boolean;
  extension?: string;
}

export type VisibleFileNode = RenderableFileNode | NestedFileNode;

export type ChildrenById<T extends VisibleFileNode = RenderableFileNode> = Map<
  NodeId | null,
  readonly T[]
>;

export function normalizeFileTreePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (normalized === '/') return normalized;
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function parentPathForNormalizedPath(path: string): string | null {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return null;
  const parentPath = parts.slice(0, -1).join('/');
  return path.startsWith('/') ? `/${parentPath}` : parentPath;
}

export function makeNode(filePath: string, type: 'file' | 'directory'): NestedFileNode {
  const path = normalizeFileTreePath(filePath);
  const parts = path.split('/').filter(Boolean);
  const name = parts[parts.length - 1] ?? path;
  const parentPath = parentPathForNormalizedPath(path);
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
  };
}

export function toRenderableFileNode(node: CoreFileNode): RenderableFileNode {
  const path = normalizeFileTreePath(node.path);
  const parts = path.split('/').filter(Boolean);
  const name = node.name || parts[parts.length - 1] || path;
  const extension = node.type === 'file' && name.includes('.') ? name.split('.').pop() : undefined;
  return {
    id: node.id,
    path,
    name,
    parentId: node.parentId,
    parentPath: parentPathForNormalizedPath(path),
    depth: parts.length - 1,
    type: node.type,
    symlink: node.type === 'symlink' ? node.symlink : undefined,
    childrenLoaded: node.childrenLoaded,
    isHidden: name.startsWith('.'),
    extension,
    directoryPreview: node.directoryPreview,
  };
}

export function sortFileNodes<T extends VisibleFileNode>(nodes: readonly T[]): T[] {
  return [...nodes].sort((a, b) => {
    const rankDiff = visibleNodeSortRank(a) - visibleNodeSortRank(b);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name);
  });
}

export function isExpandableFileTreeNode(node: VisibleFileNode): boolean {
  return (
    node.type === 'directory' ||
    (node.type === 'symlink' &&
      !!node.symlink &&
      !node.symlink.broken &&
      node.symlink.targetType === 'directory')
  );
}

export function isOpenableFileTreeNode(node: VisibleFileNode): boolean {
  return (
    node.type === 'file' ||
    (node.type === 'symlink' &&
      !!node.symlink &&
      !node.symlink.broken &&
      node.symlink.targetType === 'file')
  );
}

function visibleNodeSortRank(node: VisibleFileNode): number {
  return isExpandableFileTreeNode(node) ? 0 : 1;
}

export interface TreeRow<T extends VisibleFileNode = VisibleFileNode> {
  node: T;
  chain: T[];
  renderDepth: number;
}

function loadedRenderableDirectoryChildForSegment(
  node: RenderableFileNode,
  segment: DirectoryPreviewSegment,
  childrenById: ChildrenById<RenderableFileNode>,
  loadedPaths: ReadonlySet<string>
): RenderableFileNode | undefined {
  if (!loadedPaths.has(node.path)) return undefined;
  const segmentPath = normalizeFileTreePath(segment.path);
  return (childrenById.get(node.id) ?? []).find(
    (child) => child.type === 'directory' && child.path === segmentPath
  );
}

function syntheticChainNode(
  segment: DirectoryPreviewSegment,
  parent: RenderableFileNode
): RenderableFileNode {
  return {
    // Chain segments are not loaded scopes, so they have no real node id; the renderer keys rows by
    // path and registers a scope only once its real node has been loaded. The id is never read.
    id: -1,
    path: normalizeFileTreePath(segment.path),
    name: segment.name,
    parentId: parent.id,
    parentPath: parent.path,
    depth: parent.depth + 1,
    type: 'directory',
    childrenLoaded: false,
    isHidden: segment.name.startsWith('.'),
  };
}

/**
 * Build the compacted directory chain for a workspace file-tree node. Workspace compaction is
 * model-driven: the renderer uses only core-provided preview metadata, never partial loaded-child
 * structure.
 */
function extendFileTreePreviewChain(
  node: RenderableFileNode,
  childrenById: ChildrenById<RenderableFileNode>,
  loadedPaths: ReadonlySet<string>
): RenderableFileNode[] {
  const chain: RenderableFileNode[] = [node];
  const visited = new Set<string>([node.path]);
  const segments = node.directoryPreview?.singleChildDirectoryChain;
  if (!segments || segments.length === 0) return chain;

  let parent = node;
  for (const segment of segments) {
    const next =
      loadedRenderableDirectoryChildForSegment(parent, segment, childrenById, loadedPaths) ??
      syntheticChainNode(segment, parent);
    if (visited.has(next.path)) break;
    chain.push(next);
    visited.add(next.path);
    parent = next;
  }
  return chain;
}

function extendNestedDirectoryChain(node: NestedFileNode): NestedFileNode[] {
  const chain: NestedFileNode[] = [node];
  const visited = new Set<string>([node.path]);
  let current = node;
  while (current.type === 'directory') {
    const children = current.children;
    if (
      children.length !== 1 ||
      children[0].type !== 'directory' ||
      visited.has(children[0].path)
    ) {
      break;
    }
    current = children[0];
    visited.add(current.path);
    chain.push(current);
  }
  return chain;
}

export function isChainExpanded<T extends VisibleFileNode>(
  chain: readonly T[],
  expandedPaths: Set<string>
): boolean {
  for (const segment of chain) {
    if (expandedPaths.has(segment.path)) return true;
  }
  return false;
}

export function buildFileTreeVisibleRows(
  rootNodes: readonly RenderableFileNode[],
  expandedPaths: Set<string>,
  childrenById: ChildrenById<RenderableFileNode>,
  loadedPaths: ReadonlySet<string>
): Array<TreeRow<RenderableFileNode>> {
  const rows: Array<TreeRow<RenderableFileNode>> = [];

  function walk(nodes: readonly RenderableFileNode[], renderDepth: number) {
    for (const node of nodes) {
      const chain =
        node.type === 'directory'
          ? extendFileTreePreviewChain(node, childrenById, loadedPaths)
          : [node];
      const terminus = chain[chain.length - 1];
      rows.push({ node: terminus, chain, renderDepth });
      if (isExpandableFileTreeNode(terminus) && isChainExpanded(chain, expandedPaths)) {
        walk(childrenById.get(terminus.id) ?? [], renderDepth + 1);
      }
    }
  }

  walk(rootNodes, 0);
  return rows;
}

export function buildNestedVisibleRows(
  rootNodes: readonly NestedFileNode[],
  expandedPaths: Set<string>
): Array<TreeRow<NestedFileNode>> {
  const rows: Array<TreeRow<NestedFileNode>> = [];

  function walk(nodes: readonly NestedFileNode[], renderDepth: number) {
    for (const node of nodes) {
      const chain = node.type === 'directory' ? extendNestedDirectoryChain(node) : [node];
      const terminus = chain[chain.length - 1];
      rows.push({ node: terminus, chain, renderDepth });
      if (isExpandableFileTreeNode(terminus) && isChainExpanded(chain, expandedPaths)) {
        walk(terminus.children, renderDepth + 1);
      }
    }
  }

  walk(rootNodes, 0);
  return rows;
}
