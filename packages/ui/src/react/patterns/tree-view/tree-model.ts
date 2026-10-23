export interface TreeNode<T> {
  id: string;
  data: T;
  children?: readonly TreeNode<T>[];
}

export interface TreeRow<T> {
  node: TreeNode<T>;
  depth: number;
  chain: readonly TreeNode<T>[];
  isBranch: boolean;
  isExpanded: boolean;
}

export interface BuildVisibleTreeRowsOptions<T = unknown> {
  compactChains?: boolean;
  /** Whether a branch may join a compacted chain; every branch may by default. */
  canCompact?: (node: TreeNode<T>) => boolean;
}

export function isTreeBranch<T>(node: TreeNode<T>): boolean {
  return node.children !== undefined;
}

/**
 * A compacted row is open while the first node of its chain is, so a chain that
 * grows as children load keeps the row's state.
 */
export function isChainExpanded<T>(
  chain: readonly TreeNode<T>[],
  expandedIds: ReadonlySet<string>
): boolean {
  return chain.length > 0 && expandedIds.has(chain[0]!.id);
}

export function buildVisibleTreeRows<T>(
  nodes: readonly TreeNode<T>[],
  expandedIds: ReadonlySet<string>,
  options: BuildVisibleTreeRowsOptions<T> = {}
): TreeRow<T>[] {
  const rows: TreeRow<T>[] = [];
  appendRows(rows, nodes, expandedIds, 0, options);
  return rows;
}

function appendRows<T>(
  rows: TreeRow<T>[],
  nodes: readonly TreeNode<T>[],
  expandedIds: ReadonlySet<string>,
  depth: number,
  options: BuildVisibleTreeRowsOptions<T>
) {
  for (const node of nodes) {
    const chain = options.compactChains ? buildCompactChain(node, options.canCompact) : [node];
    const rowNode = chain[chain.length - 1]!;
    const isBranch = isTreeBranch(rowNode);
    const isExpanded = isBranch && isChainExpanded(chain, expandedIds);

    rows.push({
      node: rowNode,
      depth,
      chain,
      isBranch,
      isExpanded,
    });

    if (isExpanded && rowNode.children) {
      appendRows(rows, rowNode.children, expandedIds, depth + 1, options);
    }
  }
}

function buildCompactChain<T>(
  node: TreeNode<T>,
  canCompact: (node: TreeNode<T>) => boolean = () => true
): TreeNode<T>[] {
  const chain = [node];
  if (!canCompact(node)) return chain;
  let current = node;

  while (isTreeBranch(current) && current.children?.length === 1) {
    const child = current.children[0]!;
    if (!isTreeBranch(child) || !canCompact(child)) break;
    chain.push(child);
    current = child;
  }

  return chain;
}
