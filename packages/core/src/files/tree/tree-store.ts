import type { KeyedOp } from '../../lib';
import type { DevIno, DirectoryEntry } from './directory-reader';
import type { FileNode, NodeId } from './models/tree';
import { NodeIdAssigner, type Tombstone } from './node-id';

export type FileTreeStoreRemoval = {
  ops: Array<KeyedOp<NodeId, FileNode>>;
  unloadedScopes: NodeId[];
};

export class FileTreeStore {
  private readonly ids = new NodeIdAssigner();

  get(id: NodeId): FileNode | undefined {
    return this.ids.get(id);
  }

  getByPath(path: string): FileNode | undefined {
    return this.ids.getByPath(path);
  }

  entries(): FileNode[] {
    return this.ids.entries();
  }

  childrenOf(parentId: NodeId | null): FileNode[] {
    return this.ids.childrenOf(parentId);
  }

  upsert(entry: DirectoryEntry, parentId: NodeId | null, childrenLoaded?: boolean): FileNode {
    return this.ids.upsert(entry, parentId, childrenLoaded);
  }

  setNode(node: FileNode): void {
    this.ids.setNode(node);
  }

  markDeleted(id: NodeId): Tombstone | undefined {
    return this.ids.markDeleted(id);
  }

  tombstoneForDevIno(devIno: DevIno): Tombstone | undefined {
    return this.ids.tombstoneForDevIno(devIno);
  }

  moveDescendantPaths(rootId: NodeId, oldPrefix: string, newPrefix: string): FileNode[] {
    return this.ids.moveDescendantPaths(rootId, oldPrefix, newPrefix);
  }

  removeTombstonedSubtree(tombstone: Tombstone): FileTreeStoreRemoval {
    return this.removalFor(this.ids.removeTombstonedSubtree(tombstone));
  }

  removeSubtrees(rootIds: NodeId[]): FileTreeStoreRemoval {
    const removed: FileNode[] = [];
    for (const rootId of rootIds) {
      removed.push(...this.ids.removeSubtree(rootId));
    }
    return this.removalFor(removed);
  }

  removeMissingChildren(
    parentId: NodeId | null,
    listedPaths: ReadonlySet<string>
  ): FileTreeStoreRemoval {
    const missing = this.childrenOf(parentId)
      .filter((node) => !listedPaths.has(node.path))
      .map((node) => node.id);
    return this.removeSubtrees(missing);
  }

  pruneToReachable(loadedScopes: ReadonlySet<NodeId | null>): FileTreeStoreRemoval {
    return this.removalFor(this.ids.pruneToReachable(loadedScopes));
  }

  private removalFor(removed: FileNode[]): FileTreeStoreRemoval {
    return {
      ops: removed.map((node) => ({ op: 'del', key: node.id })),
      unloadedScopes: removed.filter((node) => node.type === 'directory').map((node) => node.id),
    };
  }
}
