import type { GitChange } from '@emdash/core/git';
import {
  makeNode,
  sortFileNodes,
  type NestedFileNode,
} from '@renderer/features/tasks/file-tree/tree-utils';

export interface ChangesTree {
  rootNodes: NestedFileNode[];
  changeByPath: Map<string, GitChange>;
  directoryPaths: Set<string>;
}

export function buildChangesTree(changes: GitChange[]): ChangesTree {
  const nodesByPath = new Map<string, NestedFileNode>();
  const changeByPath = new Map<string, GitChange>();
  const directoryPaths = new Set<string>();
  const rootNodes: NestedFileNode[] = [];

  for (const change of changes) {
    changeByPath.set(change.path, change);

    const parts = change.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    let prefix = '';
    let parentNode: NestedFileNode | null = null;
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i]!;
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const isLeaf = i === parts.length - 1;
      const type = isLeaf ? 'file' : 'directory';
      const key = `${type}:${prefix}`;

      let node = nodesByPath.get(key);
      if (!node) {
        node = makeNode(prefix, type);
        nodesByPath.set(key, node);
        if (!isLeaf) directoryPaths.add(prefix);
        if (parentNode) {
          parentNode.children.push(node);
        } else {
          rootNodes.push(node);
        }
      }
      parentNode = node;
    }
  }

  return {
    rootNodes: sortRecursively(rootNodes),
    changeByPath,
    directoryPaths,
  };
}

function sortRecursively(nodes: NestedFileNode[]): NestedFileNode[] {
  const sorted = sortFileNodes(nodes);
  for (const node of sorted) {
    if (node.children.length > 0) {
      node.children = sortRecursively(node.children);
    }
  }
  return sorted;
}
