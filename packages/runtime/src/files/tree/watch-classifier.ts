import path from 'node:path';
import type { FileTreeModel } from '@emdash/core/files';
import type { RootChange } from '../root/root-resource';

export type TreeWatchEffects = {
  resync: boolean;
  loadedParents: string[];
};

export function classifyTreeChanges(model: FileTreeModel, changes: RootChange[]): TreeWatchEffects {
  if (changes.some((change) => change.kind === 'resync' || change.path === '')) {
    return { resync: true, loadedParents: [] };
  }

  const parents = new Set<string>();
  for (const change of changes) {
    if (change.kind === 'resync') continue;
    const parent = path.posix.dirname(change.path);
    const parentPath = parent === '.' ? '' : parent;
    if (model.entries[parentPath]?.childrenLoaded) parents.add(parentPath);
    if (model.entries[change.path]?.childrenLoaded) parents.add(change.path);
  }
  return {
    resync: false,
    loadedParents: [...parents].sort((left, right) => depth(left) - depth(right)),
  };
}

function depth(entryPath: string): number {
  return entryPath === '' ? 0 : entryPath.split('/').length;
}
