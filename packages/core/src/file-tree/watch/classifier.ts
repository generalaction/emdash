import path from 'node:path';
import type { Result } from '@emdash/shared';
import type { RawFileEvent } from '../../fs';
import type { KeyedOp } from '../../lib';
import type { FileTreeError } from '../errors';
import { isExcludedPath } from '../ignores';
import { statEntry as statFileTreeEntry, type ListedEntry } from '../list';
import type { FileNode, NodeId } from '../models/tree';
import type { NodeIdAssigner, Tombstone } from '../node-id';
import { parentRelPath, resolveInsideRoot } from '../paths';

export type FileTreeStatEntry = (
  rootPath: string,
  relPath: string
) => Promise<Result<ListedEntry, FileTreeError>>;

export type FileTreeWatchClassifierOptions = {
  rootPath: string;
  ids: NodeIdAssigner;
  isScopeLoaded: (scope: NodeId | null) => boolean;
  statEntry?: FileTreeStatEntry;
};

export type FileTreeWatchClassification = {
  ops: Array<KeyedOp<NodeId, FileNode>>;
  unloadedScopes: NodeId[];
};

export async function classifyFileTreeWatchEvents(
  events: RawFileEvent[],
  options: FileTreeWatchClassifierOptions
): Promise<FileTreeWatchClassification> {
  const statEntry = options.statEntry ?? statFileTreeEntry;
  const tombstones: Tombstone[] = [];
  const ops: Array<KeyedOp<NodeId, FileNode>> = [];
  const unloadedScopes: NodeId[] = [];

  for (const event of events) {
    const relPath = relPathFromWatchEvent(options.rootPath, event);
    if (!relPath) continue;
    if (isExcludedPath(relPath)) continue;
    if (event.kind === 'update') continue;

    if (event.kind === 'delete') {
      const node = options.ids.getByPath(relPath);
      if (!node) continue;
      const tombstone = options.ids.markDeleted(node.id);
      if (tombstone) tombstones.push(tombstone);
      continue;
    }

    const stat = await statEntry(options.rootPath, relPath);
    if (!stat.success) continue;
    const parentId = parentScopeFor(stat.data, options.ids);
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

function parentScopeFor(entry: ListedEntry, ids: NodeIdAssigner): NodeId | null | undefined {
  const parentPath = parentRelPath(entry.path);
  if (!parentPath) return null;
  const parent = ids.getByPath(parentPath);
  return parent?.type === 'directory' ? parent.id : undefined;
}

function relPathFromWatchEvent(rootPath: string, event: RawFileEvent): string | null {
  const relative = path.relative(rootPath, event.path).replace(/\\/g, '/');
  const resolved = resolveInsideRoot(rootPath, relative, { allowEmpty: true });
  if (!resolved.success || !resolved.data.relPath) return null;
  return resolved.data.relPath;
}
