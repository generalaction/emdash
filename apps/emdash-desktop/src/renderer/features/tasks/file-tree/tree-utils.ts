import type { FileNode as CoreFileNode, NodeId } from '@emdash/core/file-tree';

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
  return path.replace(/\\/g, '/').split('/').filter(Boolean).join('/');
}

export function makeNode(relPath: string, type: 'file' | 'directory'): NestedFileNode {
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
    parentPath: parts.length > 1 ? parts.slice(0, -1).join('/') : null,
    depth: parts.length - 1,
    type: node.type,
    childrenLoaded: node.childrenLoaded,
    isHidden: name.startsWith('.'),
    extension,
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

function extendChain<T extends VisibleFileNode>(node: T, childrenById?: ChildrenById<T>): T[] {
  const chain: T[] = [node];
  const visited = new Set<string>([node.path]);
  let current = node;
  while (current.type === 'directory') {
    const children = childrenFor(current, childrenById);
    if (children.length !== 1 || children[0].type !== 'directory') break;
    if (visited.has(children[0].path)) break;
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

export function buildVisibleRows<T extends VisibleFileNode>(
  rootNodes: readonly T[],
  expandedPaths: Set<string>,
  childrenById?: ChildrenById<T>
): Array<TreeRow<T>> {
  const rows: Array<TreeRow<T>> = [];

  function walk(nodes: readonly T[], renderDepth: number) {
    for (const node of nodes) {
      const chain = node.type === 'directory' ? extendChain(node, childrenById) : [node];
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
