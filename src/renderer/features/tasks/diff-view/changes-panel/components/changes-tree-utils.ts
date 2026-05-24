import {
  makeNode,
  sortedChildPaths,
} from '@renderer/features/tasks/editor/stores/files-store-utils';
import { type FileNode } from '@shared/fs';
import { type GitChange } from '@shared/git';

export interface ChangesTree {
  nodes: Map<string, FileNode>;
  childIndex: Map<string | null, string[]>;
  changeByPath: Map<string, GitChange>;
  directoryPaths: Set<string>;
}

export function buildChangesTree(changes: GitChange[]): ChangesTree {
  const nodes = new Map<string, FileNode>();
  const rawChildIndex = new Map<string | null, Set<string>>();
  const changeByPath = new Map<string, GitChange>();
  const directoryPaths = new Set<string>();

  const addChild = (parent: string | null, child: string) => {
    let set = rawChildIndex.get(parent);
    if (!set) {
      set = new Set();
      rawChildIndex.set(parent, set);
    }
    set.add(child);
  };

  for (const change of changes) {
    changeByPath.set(change.path, change);

    const parts = change.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    let prefix = '';
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i]!;
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const isLeaf = i === parts.length - 1;
      const parentPath = i === 0 ? null : parts.slice(0, i).join('/');

      if (!nodes.has(prefix)) {
        nodes.set(prefix, makeNode(prefix, isLeaf ? 'file' : 'directory'));
        if (!isLeaf) directoryPaths.add(prefix);
      }
      addChild(parentPath, prefix);
    }
  }

  const childIndex = new Map<string | null, string[]>();
  for (const [parent, set] of rawChildIndex) {
    childIndex.set(parent, sortedChildPaths([...set], nodes));
  }

  return { nodes, childIndex, changeByPath, directoryPaths };
}
