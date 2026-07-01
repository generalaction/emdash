import type { DevIno, DirectoryEntry } from './directory-reader';
import { isExpandableFileNode, type FileNode, type NodeId } from './models/tree';

type NodeRecord = {
  node: FileNode;
  devIno?: DevIno;
};

export type Tombstone = {
  id: NodeId;
  node: FileNode;
  devIno?: DevIno;
};

export class NodeIdAssigner {
  private nextId = 1;
  private readonly pathToId = new Map<string, NodeId>();
  private readonly records = new Map<NodeId, NodeRecord>();
  private readonly childrenByParent = new Map<NodeId | null, Set<NodeId>>();
  private readonly devInoToId = new Map<DevIno, NodeId>();
  private readonly tombstonesByDevIno = new Map<DevIno, Tombstone>();

  get(id: NodeId): FileNode | undefined {
    return this.records.get(id)?.node;
  }

  getByPath(path: string): FileNode | undefined {
    const id = this.pathToId.get(path);
    return id === undefined ? undefined : this.get(id);
  }

  getIdByPath(path: string): NodeId | undefined {
    return this.pathToId.get(path);
  }

  getDevIno(id: NodeId): DevIno | undefined {
    return this.records.get(id)?.devIno;
  }

  tombstoneForDevIno(devIno: DevIno): Tombstone | undefined {
    return this.tombstonesByDevIno.get(devIno);
  }

  setNode(node: FileNode, devIno = this.records.get(node.id)?.devIno): void {
    this.setRecord(node.id, node, devIno);
  }

  entries(): FileNode[] {
    return [...this.records.values()].map((record) => record.node);
  }

  upsert(entry: DirectoryEntry, parentId: NodeId | null, childrenLoaded?: boolean): FileNode {
    const existingId = this.pathToId.get(entry.path);
    const tombstone = entry.devIno ? this.tombstonesByDevIno.get(entry.devIno) : undefined;
    const inodeId = entry.devIno ? this.devInoToId.get(entry.devIno) : undefined;
    const id = existingId ?? tombstone?.id ?? inodeId ?? this.nextId++;
    const previous = this.records.get(id)?.node;
    const childrenLoadedValue =
      entry.type === 'directory' ||
      (entry.type === 'symlink' &&
        !entry.symlink.broken &&
        entry.symlink.targetType === 'directory')
        ? (childrenLoaded ?? previous?.childrenLoaded ?? tombstone?.node.childrenLoaded ?? false)
        : false;
    const base = {
      id,
      path: entry.path,
      name: entry.name,
      parentId,
      childrenLoaded: childrenLoadedValue,
    };
    const node: FileNode =
      entry.type === 'symlink'
        ? { ...base, type: 'symlink', symlink: entry.symlink }
        : { ...base, type: entry.type };

    this.setRecord(id, node, entry.devIno);
    if (tombstone?.devIno) this.tombstonesByDevIno.delete(tombstone.devIno);
    return node;
  }

  markDeleted(id: NodeId): Tombstone | undefined {
    const record = this.records.get(id);
    if (!record) return undefined;
    this.removeRecord(id);
    const tombstone: Tombstone = { id, node: record.node, devIno: record.devIno };
    if (record.devIno) this.tombstonesByDevIno.set(record.devIno, tombstone);
    return tombstone;
  }

  forgetTombstone(tombstone: Tombstone): void {
    if (tombstone.devIno && this.tombstonesByDevIno.get(tombstone.devIno) === tombstone) {
      this.tombstonesByDevIno.delete(tombstone.devIno);
    }
  }

  removeSubtree(rootId: NodeId): FileNode[] {
    const removed: FileNode[] = [];
    const visit = (id: NodeId) => {
      const node = this.records.get(id)?.node;
      if (!node) return;
      for (const child of this.childrenOf(id)) visit(child.id);
      this.removeRecord(id);
      removed.push(node);
    };
    visit(rootId);
    return removed;
  }

  removeTombstonedSubtree(tombstone: Tombstone): FileNode[] {
    const removed: FileNode[] = [];
    for (const child of this.childrenOf(tombstone.id)) {
      removed.push(...this.removeSubtree(child.id));
    }
    this.forgetTombstone(tombstone);
    removed.push(tombstone.node);
    return removed;
  }

  moveDescendantPaths(rootId: NodeId, oldPrefix: string, newPrefix: string): FileNode[] {
    const moved: FileNode[] = [];
    const visit = (parentId: NodeId) => {
      for (const node of this.childrenOf(parentId)) {
        const movedPath = movePathUnderPrefix(node.path, oldPrefix, newPrefix);
        if (!movedPath) continue;
        const next: FileNode = {
          ...node,
          path: movedPath,
          directoryPreview: node.directoryPreview
            ? {
                childCount: node.directoryPreview.childCount,
                singleChildDirectoryChain: node.directoryPreview.singleChildDirectoryChain.map(
                  (segment) => ({
                    ...segment,
                    path: movePathUnderPrefix(segment.path, oldPrefix, newPrefix) ?? segment.path,
                  })
                ),
              }
            : undefined,
        };
        this.setNode(next);
        moved.push(next);
        visit(next.id);
      }
    };
    visit(rootId);
    return moved;
  }

  childrenOf(parentId: NodeId | null): FileNode[] {
    const ids = this.childrenByParent.get(parentId);
    if (!ids) return [];
    const children: FileNode[] = [];
    for (const id of ids) {
      const node = this.get(id);
      if (node) children.push(node);
    }
    return children;
  }

  pruneToReachable(loadedScopes: ReadonlySet<NodeId | null>): FileNode[] {
    const reachable = new Set<NodeId>();
    const visited = new Set<NodeId | null>();
    const queue: Array<NodeId | null> = [null];
    while (queue.length > 0) {
      const scope = queue.shift() as NodeId | null;
      if (visited.has(scope)) continue;
      visited.add(scope);
      for (const child of this.childrenOf(scope)) {
        reachable.add(child.id);
        if (isExpandableFileNode(child) && loadedScopes.has(child.id)) queue.push(child.id);
      }
    }

    const removed: FileNode[] = [];
    for (const id of [...this.records.keys()]) {
      if (reachable.has(id)) continue;
      const record = this.records.get(id);
      if (!record) continue;
      this.removeRecord(id);
      removed.push(record.node);
    }
    return removed;
  }

  reset(nodes: Array<{ node: FileNode; devIno?: DevIno }>): void {
    this.pathToId.clear();
    this.records.clear();
    this.childrenByParent.clear();
    this.devInoToId.clear();
    this.tombstonesByDevIno.clear();
    this.nextId = 1;
    for (const { node, devIno } of nodes) {
      this.setRecord(node.id, node, devIno);
      this.nextId = Math.max(this.nextId, node.id + 1);
    }
  }

  private setRecord(id: NodeId, node: FileNode, devIno?: DevIno): void {
    const previous = this.records.get(id);
    if (previous) {
      this.pathToId.delete(previous.node.path);
      this.removeChild(previous.node.parentId, id);
      if (previous.devIno) this.devInoToId.delete(previous.devIno);
    }
    this.pathToId.set(node.path, id);
    this.addChild(node.parentId, id);
    if (devIno) this.devInoToId.set(devIno, id);
    this.records.set(id, { node, devIno });
  }

  private removeRecord(id: NodeId): void {
    const record = this.records.get(id);
    if (!record) return;
    this.pathToId.delete(record.node.path);
    this.removeChild(record.node.parentId, id);
    if (record.devIno) this.devInoToId.delete(record.devIno);
    this.records.delete(id);
  }

  private addChild(parentId: NodeId | null, id: NodeId): void {
    let children = this.childrenByParent.get(parentId);
    if (!children) {
      children = new Set();
      this.childrenByParent.set(parentId, children);
    }
    children.add(id);
  }

  private removeChild(parentId: NodeId | null, id: NodeId): void {
    const children = this.childrenByParent.get(parentId);
    if (!children) return;
    children.delete(id);
    if (children.size === 0) this.childrenByParent.delete(parentId);
  }
}

export function nodeHasSymlinkAncestor(
  getNode: (id: NodeId) => FileNode | undefined,
  parentId: NodeId | null
): boolean {
  let currentId = parentId;
  while (currentId !== null) {
    const node = getNode(currentId);
    if (!node) return false;
    if (node.type === 'symlink') return true;
    currentId = node.parentId;
  }
  return false;
}

function movePathUnderPrefix(
  childPath: string,
  oldPrefix: string,
  newPrefix: string
): string | null {
  const normalizedChild = normalizePathForComparison(childPath);
  const normalizedOld = normalizePathForComparison(oldPrefix).replace(/\/+$/, '');
  const oldWithSlash = `${normalizedOld}/`;
  if (!normalizedChild.startsWith(oldWithSlash)) return null;

  const relative = normalizedChild.slice(oldWithSlash.length);
  const separator = preferredSeparator(newPrefix);
  const base = newPrefix.replace(/[\\/]+$/, '');
  return `${base}${separator}${relative.replace(/\//g, separator)}`;
}

function normalizePathForComparison(value: string): string {
  return value.replace(/\\/g, '/');
}

function preferredSeparator(value: string): '/' | '\\' {
  return value.lastIndexOf('\\') > value.lastIndexOf('/') ? '\\' : '/';
}
