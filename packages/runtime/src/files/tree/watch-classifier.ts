import type { FileTreeModel } from '@emdash/core/files';
import { portableRelativePathDirname, type PortableRelativePath } from '@emdash/core/path';
import type { RootChange } from '../root/root-resource';

export type TreeWatchEffects = {
  resync: boolean;
  loadedParents: PortableRelativePath[];
};

export function classifyTreeChanges(model: FileTreeModel, changes: RootChange[]): TreeWatchEffects {
  if (changes.some((change) => change.kind === 'resync' || change.path === '')) {
    return { resync: true, loadedParents: [] };
  }

  const parents = new Set<PortableRelativePath>();
  for (const change of changes) {
    if (change.kind === 'resync') continue;
    const parentPath = portableRelativePathDirname(change.path);
    if (parentPath !== null && model.entries[parentPath]?.childrenLoaded) parents.add(parentPath);
    if (model.entries[change.path]?.childrenLoaded) parents.add(change.path);
  }
  return {
    resync: false,
    loadedParents: [...parents].sort((left, right) => depth(left) - depth(right)),
  };
}

function depth(entryPath: PortableRelativePath): number {
  return entryPath === '' ? 0 : entryPath.split('/').length;
}
