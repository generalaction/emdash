import type { CompactChainSegment, FileNode as CoreFileNode, NodeId } from '@emdash/core/files';

export interface RenderableFileNode {
  id: NodeId;
  path: string;
  name: string;
  parentId: NodeId | null;
  parentPath: string | null;
  depth: number;
  type: 'file' | 'directory';
  childrenLoaded: boolean;
  isHidden: boolean;
  extension?: string;
  /** Number of children, probed one level ahead by core; `undefined` for files/unprobed dirs. */
  childCount?: number;
  /** Core-computed single-child directory chain that collapses into this node's row. */
  compactChain?: CompactChainSegment[];
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
    childrenLoaded: node.childrenLoaded,
    isHidden: name.startsWith('.'),
    extension,
    childCount: node.childCount,
    compactChain: node.compactChain,
  };
}

export function sortFileNodes<T extends VisibleFileNode>(nodes: readonly T[]): T[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export interface TreeRow<T extends VisibleFileNode = VisibleFileNode> {
  node: T;
  chain: T[];
  renderDepth: number;
}

function hasNestedChildren(node: VisibleFileNode): node is NestedFileNode {
  return 'children' in node;
}

function childrenFor<T extends VisibleFileNode>(
  node: T,
  childrenById?: ChildrenById<T>
): readonly T[] {
  if (childrenById && 'id' in node) return childrenById.get(node.id) ?? [];
  return hasNestedChildren(node) ? (node.children as unknown as readonly T[]) : [];
}

/**
 * The loaded children of `node`, or `undefined` when this view has not loaded that scope yet.
 * Nested git-changes nodes always carry their children inline, so they are always "loaded".
 */
function loadedChildrenFor<T extends VisibleFileNode>(
  node: T,
  childrenById?: ChildrenById<T>,
  loadedPaths?: ReadonlySet<string>
): readonly T[] | undefined {
  if (hasNestedChildren(node)) return node.children as unknown as readonly T[];
  if (!childrenById || !('id' in node)) return undefined;
  if (loadedPaths) {
    return loadedPaths.has(node.path) ? (childrenById.get(node.id) ?? []) : undefined;
  }
  // Without explicit load info, treat presence in the index as "loaded".
  return childrenById.has(node.id) ? (childrenById.get(node.id) ?? []) : undefined;
}

function compactChainOf(node: VisibleFileNode): CompactChainSegment[] | undefined {
  return 'compactChain' in node ? node.compactChain : undefined;
}

function syntheticChainNode(
  segment: CompactChainSegment,
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
 * Build the compacted directory chain for `node`: a run of single-child directories rendered as one
 * row. While a scope is loaded, the chain follows real children; once it reaches an unloaded scope
 * it continues from the core-computed `compactChain` metadata so collapsed chains compact without
 * the renderer probing the filesystem.
 */
function extendChain<T extends VisibleFileNode>(
  node: T,
  childrenById?: ChildrenById<T>,
  loadedPaths?: ReadonlySet<string>
): T[] {
  const chain: T[] = [node];
  const visited = new Set<string>([node.path]);
  let current = node;
  while (current.type === 'directory') {
    const children = loadedChildrenFor(current, childrenById, loadedPaths);
    if (children !== undefined) {
      if (
        children.length === 1 &&
        children[0].type === 'directory' &&
        !visited.has(children[0].path)
      ) {
        current = children[0];
        visited.add(current.path);
        chain.push(current);
        continue;
      }
      break;
    }
    const segments = compactChainOf(current);
    if (!segments || segments.length === 0) break;
    let parent = current as unknown as RenderableFileNode;
    for (const segment of segments) {
      const synthetic = syntheticChainNode(segment, parent);
      if (visited.has(synthetic.path)) break;
      chain.push(synthetic as unknown as T);
      visited.add(synthetic.path);
      parent = synthetic;
    }
    break;
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

export function buildVisibleRows<T extends VisibleFileNode>(
  rootNodes: readonly T[],
  expandedPaths: Set<string>,
  childrenById?: ChildrenById<T>,
  loadedPaths?: ReadonlySet<string>
): Array<TreeRow<T>> {
  const rows: Array<TreeRow<T>> = [];

  function walk(nodes: readonly T[], renderDepth: number) {
    for (const node of nodes) {
      const chain =
        node.type === 'directory' ? extendChain(node, childrenById, loadedPaths) : [node];
      const terminus = chain[chain.length - 1];
      rows.push({ node: terminus, chain, renderDepth });
      if (terminus.type === 'directory' && isChainExpanded(chain, expandedPaths)) {
        walk(childrenFor(terminus, childrenById), renderDepth + 1);
      }
    }
  }

  walk(rootNodes, 0);
  return rows;
}
