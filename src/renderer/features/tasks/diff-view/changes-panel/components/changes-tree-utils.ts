import { makeNode, sortFileNodes } from '@renderer/features/tasks/editor/stores/files-store-utils';
import { type FileNode } from '@shared/fs';
import { type GitChange, type GitChangeStatus } from '@shared/git';

export interface ChangesTree {
  rootNodes: FileNode[];
  changeByPath: Map<string, GitChange>;
  directoryPaths: Set<string>;
  directoryStatusByPath: Map<string, GitChangeStatus>;
}

const STATUS_PRIORITY: Record<GitChangeStatus, number> = {
  conflicted: 5,
  deleted: 4,
  modified: 3,
  renamed: 2,
  added: 1,
};

export function buildChangesTree(changes: GitChange[]): ChangesTree {
  const nodesByPath = new Map<string, FileNode>();
  const changeByPath = new Map<string, GitChange>();
  const directoryPaths = new Set<string>();
  const rootNodes: FileNode[] = [];

  for (const change of changes) {
    changeByPath.set(change.path, change);

    const parts = change.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    let prefix = '';
    let parentNode: FileNode | null = null;
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
    directoryStatusByPath: buildDirectoryStatusByPath(changes),
  };
}

export function buildDirectoryStatusByPath(changes: GitChange[]): Map<string, GitChangeStatus> {
  const directoryStatusByPath = new Map<string, GitChangeStatus>();

  for (const change of changes) {
    const parts = change.path.split('/').filter(Boolean);
    if (parts.length < 2) continue;

    let prefix = '';
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? `${prefix}/${parts[i]!}` : parts[i]!;
      const existing = directoryStatusByPath.get(prefix);
      if (!existing || STATUS_PRIORITY[change.status] > STATUS_PRIORITY[existing]) {
        directoryStatusByPath.set(prefix, change.status);
      }
    }
  }

  return directoryStatusByPath;
}

function sortRecursively(nodes: FileNode[]): FileNode[] {
  const sorted = sortFileNodes(nodes);
  for (const node of sorted) {
    if (node.children.length > 0) {
      node.children = sortRecursively(node.children);
    }
  }
  return sorted;
}
