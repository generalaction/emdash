import path from 'node:path';
import type { KeyedOp } from '../../../lib';
import type { WatchEvent } from '../../../watch';
import type { RootPathPolicy } from '../../path-policy';
import type { TreeDirectoryReader, DirectoryEntry } from '../directory-reader';
import type { FileNode, NodeId } from '../models/tree';
import type { Tombstone } from '../node-id';
import type { FileTreeStore } from '../tree-store';

export type FileTreeWatchClassifierOptions = {
  pathPolicy: RootPathPolicy;
  directoryReader: TreeDirectoryReader;
  store: FileTreeStore;
  isScopeLoaded: (scope: NodeId | null) => boolean;
};

export type FileTreeWatchClassification = {
  ops: Array<KeyedOp<NodeId, FileNode>>;
  unloadedScopes: NodeId[];
};

export async function classifyFileTreeWatchEvents(
  events: WatchEvent[],
  options: FileTreeWatchClassifierOptions
): Promise<FileTreeWatchClassification> {
  const tombstones: Tombstone[] = [];
  const ops: Array<KeyedOp<NodeId, FileNode>> = [];
  const unloadedScopes: NodeId[] = [];

  for (const event of events) {
    const absPath = options.pathPolicy.absoluteFromWatchEvent(event.path);
    if (!absPath) continue;
    if (event.kind === 'update') continue;

    if (event.kind === 'delete') {
      const node = options.store.getByPath(absPath);
      if (!node) continue;
      const tombstone = options.store.markDeleted(node.id);
      if (tombstone) tombstones.push(tombstone);
      continue;
    }

    const stat = await options.directoryReader.statEntry(absPath);
    if (!stat.success) continue;
    const parentId = parentScopeFor(stat.data, options.pathPolicy.rootPath, options.store);
    if (parentId === undefined || !options.isScopeLoaded(parentId)) continue;

    const matchedTombstone = stat.data.devIno
      ? options.store.tombstoneForDevIno(stat.data.devIno)
      : undefined;
    const node = options.store.upsert(stat.data, parentId);
    ops.push({ op: 'put', key: node.id, value: node });

    if (matchedTombstone && node.type === 'directory') {
      for (const moved of options.store.moveDescendantPaths(
        matchedTombstone.id,
        matchedTombstone.node.path,
        node.path
      )) {
        ops.push({ op: 'put', key: moved.id, value: moved });
      }
    }
  }

  for (const tombstone of tombstones) {
    if (options.store.get(tombstone.id)) continue;
    const removal = options.store.removeTombstonedSubtree(tombstone);
    ops.push(...removal.ops);
    unloadedScopes.push(...removal.unloadedScopes);
  }

  return { ops, unloadedScopes };
}

function parentScopeFor(
  entry: DirectoryEntry,
  rootPath: string,
  store: FileTreeStore
): NodeId | null | undefined {
  const parentPath = path.dirname(entry.path);
  if (parentPath === entry.path || parentPath === rootPath) return null;
  const parent = store.getByPath(parentPath);
  return parent?.type === 'directory' ? parent.id : undefined;
}
