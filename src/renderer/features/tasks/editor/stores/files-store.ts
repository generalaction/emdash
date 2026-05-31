import {
  isExcluded,
  makeNode,
  normalizeFileTreePath,
  sortFileNodes,
} from '@renderer/features/tasks/editor/stores/files-store-utils';
import { events, rpc } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { type FileNode, type FileWatchEvent } from '@shared/fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilesData {
  nodes: Map<string, FileNode>;
  rootNodes: FileNode[];
}

// ---------------------------------------------------------------------------
// FilesStore
// ---------------------------------------------------------------------------

export class FilesStore {
  // Non-observable imperative maps — tree.data drives reactive re-renders.
  private readonly _nodes = new Map<string, FileNode>();
  private _rootNodes: FileNode[] = [];
  private readonly _loadedPaths = new Set<string>();
  private readonly _pendingPaths = new Set<string>();
  private _bumpTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The reactive container for the file tree. Components observe `tree.data`
   * (or access `nodes`/`rootNodes` getters which read through `tree.data`).
   * The data object reference is replaced whenever the tree structure changes,
   * triggering MobX re-renders — replacing the old `generation` counter.
   */
  readonly tree: Resource<FilesData, FileWatchEvent[]>;

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string
  ) {
    this.tree = new Resource<FilesData, FileWatchEvent[]>(
      () => this._fetchAll(),
      [
        {
          kind: 'event',
          subscribe: (handler) => {
            rpc.fs.watchSetPaths(projectId, workspaceId, [''], 'filetree').catch(() => {});
            const unsub = events.on(fsWatchEventChannel, (data) => {
              if (data.workspaceId !== workspaceId) return;
              handler(data.events);
            });
            return () => {
              unsub();
              rpc.fs.watchStop(projectId, workspaceId, 'filetree').catch(() => {});
            };
          },
          onEvent: (watchEvents, ctx) => {
            if (!ctx.data) {
              ctx.reload();
              return;
            }
            const changed = this._applyWatchEventsInternal(watchEvents);
            if (changed) ctx.set({ nodes: this._nodes, rootNodes: this._rootNodes });
          },
        },
      ],
      { refData: true }
    );
  }

  // ---------------------------------------------------------------------------
  // Public reactive getters
  // ---------------------------------------------------------------------------

  /**
   * Reading `nodes` establishes a MobX dependency on `tree.data`.
   * When the tree structure changes (`tree.data` gets a new object reference),
   * observer components re-render. The `??` fallback covers the initial null
   * state; once set, `tree.data.nodes` and `_nodes` are the same Map instance.
   */
  get nodes(): Map<string, FileNode> {
    return this.tree.data?.nodes ?? this._nodes;
  }

  get rootNodes(): FileNode[] {
    return this.tree.data?.rootNodes ?? this._rootNodes;
  }

  get loadedPaths(): Set<string> {
    return this._loadedPaths;
  }

  get pendingPaths(): Set<string> {
    return this._pendingPaths;
  }

  get isLoading(): boolean {
    return this.tree.loading;
  }

  get error(): string | undefined {
    return this.tree.error;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Start watching — triggers initial load and subscribes to FS events. */
  startWatching(): void {
    this.tree.start();
  }

  dispose(): void {
    if (this._bumpTimer) {
      clearTimeout(this._bumpTimer);
      this._bumpTimer = null;
    }
    this.tree.dispose();
  }

  // ---------------------------------------------------------------------------
  // Public incremental loading (called from UI on expand/reveal)
  // ---------------------------------------------------------------------------

  async loadDir(dirPath: string, force = false): Promise<void> {
    await this._loadDirInternal(normalizeFileTreePath(dirPath), force);
    this._bumpTreeDebounced();
  }

  /** Optimistically insert dropped nodes and bump the tree once. */
  addOptimisticNodes(nodes: Array<{ relPath: string; type: 'file' | 'directory' }>): string[] {
    const inserted: string[] = [];
    const affectedParents = new Set<string | null>();

    for (const { relPath, type } of nodes) {
      const path = normalizeFileTreePath(relPath);
      if (!path || isExcluded(path) || this._nodes.has(path)) continue;

      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      if (!this._loadedPaths.has(parent)) continue;

      const node = makeNode(path, type);
      this._addNode(node);
      affectedParents.add(node.parentPath);
      inserted.push(path);
    }

    if (inserted.length > 0) {
      for (const parentPath of affectedParents) {
        this._sortChildren(parentPath ? this._nodes.get(parentPath) : null);
      }
      this._bumpTree();
    }
    return inserted;
  }

  removeNode(relPath: string): void {
    const path = normalizeFileTreePath(relPath);
    if (!this._nodes.has(path)) return;
    this._removeNode(path);
    this._bumpTree();
  }

  async revealFile(filePath: string, expandedPaths: Set<string>): Promise<void> {
    const parts = normalizeFileTreePath(filePath).split('/').filter(Boolean);
    const dirs: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      dirs.push(parts.slice(0, i).join('/'));
    }

    for (const dir of dirs) {
      await this._loadDirInternal(dir);
    }

    for (const dir of dirs) expandedPaths.add(dir);
    this._bumpTree();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Initial load used as the Resource's fetch function. */
  private async _fetchAll(): Promise<FilesData> {
    this._nodes.clear();
    this._rootNodes = [];
    this._loadedPaths.clear();
    this._pendingPaths.clear();
    await this._loadDirInternal('');
    return { nodes: this._nodes, rootNodes: this._rootNodes };
  }

  /** Load a single directory level into the backing Maps. No reactivity bump. */
  private async _loadDirInternal(dirPath: string, force = false): Promise<void> {
    dirPath = normalizeFileTreePath(dirPath);
    if (!force && (this._loadedPaths.has(dirPath) || this._pendingPaths.has(dirPath))) return;
    this._pendingPaths.add(dirPath);

    try {
      const result = await rpc.fs.listFiles(this.projectId, this.workspaceId, dirPath || '.', {
        recursive: false,
        includeHidden: true,
      });

      if (!result.success) return;

      this._applyEntries(dirPath, result.data.entries);

      for (const entry of result.data.entries) {
        const path = normalizeFileTreePath(entry.path);
        if (entry.type === 'dir' && path && !isExcluded(path)) {
          void this._loadDirInternal(path);
        }
      }

      this._bumpTreeDebounced();
    } catch {
      // Silently ignore errors for individual directories
    } finally {
      this._pendingPaths.delete(dirPath);
    }
  }

  private _applyEntries(
    dirPath: string,
    entries: Array<{ path: string; type: 'file' | 'dir'; mtime?: Date }>
  ): void {
    const normalizedDirPath = normalizeFileTreePath(dirPath);
    const parent = this._ensureDirectory(normalizedDirPath);
    const nextChildren = new Set<string>();

    for (const entry of entries) {
      const path = normalizeFileTreePath(entry.path);
      if (!path || isExcluded(path)) continue;

      const node = makeNode(path, entry.type === 'dir' ? 'directory' : 'file', entry.mtime);
      if ((node.parentPath ?? '') !== normalizedDirPath) continue;

      nextChildren.add(node.path);
      this._addNode(node);
    }

    const currentChildren = parent?.children ?? this._rootNodes;
    for (const child of [...currentChildren]) {
      if (!nextChildren.has(child.path)) {
        this._removeNode(child.path);
      }
    }

    this._sortChildren(parent);
    this._loadedPaths.add(normalizedDirPath);
  }

  private _ensureDirectory(path: string): FileNode | null {
    if (!path) return null;

    const parts = path.split('/').filter(Boolean);
    let currentPath = '';
    let current: FileNode | null = null;

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const existing = this._nodes.get(currentPath);
      if (existing) {
        current = existing;
        continue;
      }

      current = makeNode(currentPath, 'directory');
      this._addNode(current);
    }

    return current;
  }

  private _addNode(node: FileNode): void {
    const existing = this._nodes.get(node.path);
    if (existing) {
      this._replaceExistingNode(existing, node);
      return;
    }

    this._nodes.set(node.path, node);
    const parent = node.parentPath ? this._nodes.get(node.parentPath) : null;
    const siblings = parent?.children ?? this._rootNodes;
    if (!siblings.some((child) => child.path === node.path)) siblings.push(node);
  }

  private _replaceExistingNode(existing: FileNode, next: FileNode): void {
    if (existing.type === 'directory' && next.type === 'file') {
      this._replaceDirectoryWithFile(existing, next);
      return;
    }

    existing.type = next.type;
    existing.mtime = next.mtime;
    existing.extension = next.extension;
    existing.isHidden = next.isHidden;
  }

  private _replaceDirectoryWithFile(existing: FileNode, next: FileNode): void {
    const parent = existing.parentPath ? this._nodes.get(existing.parentPath) : null;
    const siblings = parent?.children ?? this._rootNodes;
    const index = siblings.findIndex((child) => child.path === existing.path);

    this._removeNodeFromMaps(existing);
    this._nodes.set(next.path, next);

    if (index === -1) {
      siblings.push(next);
    } else {
      siblings[index] = next;
    }
  }

  private _removeNode(path: string): void {
    const node = this._nodes.get(path);
    if (!node) return;

    const parent = node.parentPath ? this._nodes.get(node.parentPath) : null;
    const siblings = parent?.children ?? this._rootNodes;
    const index = siblings.findIndex((child) => child.path === path);
    if (index !== -1) siblings.splice(index, 1);

    this._removeNodeFromMaps(node);
  }

  private _removeNodeFromMaps(node: FileNode): void {
    for (const child of [...node.children]) {
      this._removeNodeFromMaps(child);
    }
    this._nodes.delete(node.path);
    this._loadedPaths.delete(node.path);
  }

  private _sortChildren(parent: FileNode | null | undefined): void {
    if (parent) {
      parent.children = sortFileNodes(parent.children);
    } else {
      this._rootNodes = sortFileNodes(this._rootNodes);
    }
  }

  /** Mutate the backing maps for watch events. Returns true if anything changed. */
  private _applyWatchEventsInternal(watchEvents: FileWatchEvent[]): boolean {
    let changed = false;
    const affectedParents = new Set<string | null>();

    for (const evt of watchEvents) {
      const path = normalizeFileTreePath(evt.path);
      if (isExcluded(path)) continue;

      if (evt.type === 'create') {
        const node = makeNode(path, evt.entryType);
        const parentLoaded = this._loadedPaths.has(node.parentPath ?? '');
        if (parentLoaded && !this._nodes.has(node.path)) {
          this._addNode(node);
          affectedParents.add(node.parentPath);
          changed = true;
        }
      } else if (evt.type === 'delete') {
        const existing = this._nodes.get(path);
        if (existing) {
          affectedParents.add(existing.parentPath);
          this._removeNode(path);
          changed = true;
        }
      } else if (evt.type === 'modify') {
        const existing = this._nodes.get(path);
        if (existing) {
          existing.mtime = new Date();
          changed = true;
        }
      } else if (evt.type === 'rename' && evt.oldPath) {
        const oldPath = normalizeFileTreePath(evt.oldPath);
        if (this._nodes.has(oldPath)) {
          this._removeNode(oldPath);
          changed = true;
        }
        const node = makeNode(path, evt.entryType);
        const parentLoaded = this._loadedPaths.has(node.parentPath ?? '');
        if (parentLoaded) {
          this._addNode(node);
          affectedParents.add(node.parentPath);
          changed = true;
        }
      }
    }

    for (const parentPath of affectedParents) {
      this._sortChildren(parentPath ? this._nodes.get(parentPath) : null);
    }

    return changed;
  }

  private _bumpTree(): void {
    this.tree.setValue({ nodes: this._nodes, rootNodes: this._rootNodes });
  }

  private _bumpTreeDebounced(): void {
    if (this._bumpTimer) return;
    this._bumpTimer = setTimeout(() => {
      this._bumpTimer = null;
      this._bumpTree();
    }, 50);
  }
}
