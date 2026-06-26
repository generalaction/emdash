import path from 'node:path';
import type { KeyedOp } from '../../../lib';
import type { WatchEvent } from '../../../watch';
import { isIgnoredInsideRoot } from '../../ignores';
import { contains } from '../../paths';
import { statEntry as statFileTreeEntry, type ListedEntry } from '../list';
import type { FileNode, NodeId } from '../models/tree';
import type { NodeIdAssigner, Tombstone } from '../node-id';

export type FileTreeWatchClassifierOptions = {
  rootPath: string;
  ids: NodeIdAssigner;
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
    const absPath = absolutePathFromWatchEvent(options.rootPath, event);
    if (!absPath) continue;
    if (isIgnoredInsideRoot(options.rootPath, absPath)) continue;
    if (event.kind === 'update') continue;

    if (event.kind === 'delete') {
      const node = options.ids.getByPath(absPath);
      if (!node) continue;
      const tombstone = options.ids.markDeleted(node.id);
      if (tombstone) tombstones.push(tombstone);
      continue;
    }

    const stat = await statFileTreeEntry(options.rootPath, absPath);
    if (!stat.success) continue;
    const parentId = parentScopeFor(stat.data, options.rootPath, options.ids);
    if (parentId === undefined || !options.isScopeLoaded(parentId)) continue;

    const matchedTombstone = stat.data.devIno
      ? options.ids.tombstoneForDevIno(stat.data.devIno)
      : undefined;
    const node = options.ids.upsert(stat.data, parentId);
    ops.push({ op: 'put', key: node.id, value: node });

    if (matchedTombstone && node.type === 'directory') {
      for (const moved of options.ids.moveDescendantPaths(
        matchedTombstone.id,
        matchedTombstone.node.path,
        node.path
      )) {
        ops.push({ op: 'put', key: moved.id, value: moved });
      }
    }
  }

  for (const tombstone of tombstones) {
    if (options.ids.get(tombstone.id)) continue;
    for (const removedNode of options.ids.removeTombstonedSubtree(tombstone)) {
      ops.push({ op: 'del', key: removedNode.id });
      if (removedNode.type === 'directory') unloadedScopes.push(removedNode.id);
    }
  }

  return { ops, unloadedScopes };
}

function parentScopeFor(
  entry: ListedEntry,
  rootPath: string,
  ids: NodeIdAssigner
): NodeId | null | undefined {
  const parentPath = path.dirname(entry.path);
  if (parentPath === entry.path || parentPath === rootPath) return null;
  const parent = ids.getByPath(parentPath);
  return parent?.type === 'directory' ? parent.id : undefined;
}

function absolutePathFromWatchEvent(rootPath: string, event: WatchEvent): string | null {
  const relative = path.relative(rootPath, event.path).replace(/\\/g, '/');
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
    return null;
  }
  const absPath = path.normalize(event.path);
  return contains(rootPath, absPath) ? absPath : null;
}
