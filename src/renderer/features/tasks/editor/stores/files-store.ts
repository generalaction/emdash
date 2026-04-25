import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { FileNode, FileWatchEvent } from '@shared/fs';
import {
  isExcluded,
  makeNode,
  sortedChildPaths,
} from '@renderer/features/tasks/editor/stores/files-store-utils';
import { events, rpc } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilesData {
  nodes: Map<string, FileNode>;
  childIndex: Map<string | null, string[]>;
}

// ---------------------------------------------------------------------------
// FilesStore
// ---------------------------------------------------------------------------

export class FilesStore {
  // Non-observable imperative maps — tree.data drives reactive re-renders.
  private readonly _nodes = new Map<string, FileNode>();
  private readonly _childIndex = new Map<string | null, string[]>();
  private readonly _loadedPaths = new Set<string>();
  private readonly _pendingPaths = new Set<string>();
  private _bumpTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The reactive container for the file tree. Components observe `tree.data`
   * (or access `nodes`/`childIndex` getters which read through `tree.data`).
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
            if (changed) ctx.set({ nodes: this._nodes, childIndex: this._childIndex });
          },
        },
      ]
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

  get childIndex(): Map<string | null, string[]> {
    return this.tree.data?.childIndex ?? this._childIndex;
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
    await this._loadDirInternal(dirPath, force);
    this._bumpTreeDebounced();
  }

  async revealFile(filePath: string, expandedPaths: Set<string>): Promise<void> {
    const parts = filePath.split('/').filter(Boolean);
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

  /** Full recursive load used as the Resource's fetch function. */
  private async _fetchAll(): Promise<FilesData> {
    this._nodes.clear();
    this._childIndex.clear();
    this._loadedPaths.clear();
    this._pendingPaths.clear();
    await this._loadDirInternal('');
    return { nodes: this._nodes, childIndex: this._childIndex };
  }

  /** Load a single directory level into the backing Maps. No reactivity bump. */
  private async _loadDirInternal(dirPath: string, force = false): Promise<void> {
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
        if (entry.type === 'dir' && !isExcluded(entry.path)) {
          void this._loadDirInternal(entry.path);
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
    const affectedParents = new Set<string | null>();

    for (const entry of entries) {
      if (isExcluded(entry.path)) continue;
      const node = makeNode(entry.path, entry.type === 'dir' ? 'directory' : 'file', entry.mtime);

      this._nodes.set(node.path, node);

      const parent = node.parentPath;
      const siblings = this._childIndex.get(parent) ?? [];
      if (!siblings.includes(node.path)) {
        siblings.push(node.path);
        this._childIndex.set(parent, siblings);
      }
      affectedParents.add(parent);
    }

    for (const parent of affectedParents) {
      const children = this._childIndex.get(parent);
      if (children) {
        this._childIndex.set(parent, sortedChildPaths(children, this._nodes));
      }
    }

    this._loadedPaths.add(dirPath);
  }

  private _addNode(node: FileNode): void {
    this._nodes.set(node.path, node);
    const parent = node.parentPath;
    const existing = this._childIndex.get(parent) ?? [];
    if (!existing.includes(node.path)) {
      this._childIndex.set(parent, sortedChildPaths([...existing, node.path], this._nodes));
    }
  }

  private _removeNode(path: string): void {
    const node = this._nodes.get(path);
    if (!node) return;

    const siblings = this._childIndex.get(node.parentPath) ?? [];
    this._childIndex.set(
      node.parentPath,
      siblings.filter((p) => p !== path)
    );

    const toRemove: string[] = [path];
    while (toRemove.length) {
      const p = toRemove.pop()!;
      this._nodes.delete(p);
      this._loadedPaths.delete(p);
      const children = this._childIndex.get(p) ?? [];
      toRemove.push(...children);
      this._childIndex.delete(p);
    }
  }

  /** Mutate the backing maps for watch events. Returns true if anything changed. */
  private _applyWatchEventsInternal(watchEvents: FileWatchEvent[]): boolean {
    let changed = false;

    for (const evt of watchEvents) {
      if (isExcluded(evt.path)) continue;

      if (evt.type === 'create') {
        const node = makeNode(evt.path, evt.entryType);
        const parentLoaded = this._loadedPaths.has(node.parentPath ?? '');
        if (parentLoaded && !this._nodes.has(evt.path)) {
          this._addNode(node);
          changed = true;
        }
      } else if (evt.type === 'delete') {
        if (this._nodes.has(evt.path)) {
          this._removeNode(evt.path);
          changed = true;
        }
      } else if (evt.type === 'modify') {
        const existing = this._nodes.get(evt.path);
        if (existing) {
          this._nodes.set(evt.path, { ...existing, mtime: new Date() });
          changed = true;
        }
      } else if (evt.type === 'rename' && evt.oldPath) {
        if (this._nodes.has(evt.oldPath)) {
          this._removeNode(evt.oldPath);
          changed = true;
        }
        const node = makeNode(evt.path, evt.entryType);
        const parentLoaded = this._loadedPaths.has(node.parentPath ?? '');
        if (parentLoaded) {
          this._addNode(node);
          changed = true;
        }
      }
    }

    return changed;
  }

  private _bumpTree(): void {
    this.tree.setValue({ nodes: this._nodes, childIndex: this._childIndex });
  }

  private _bumpTreeDebounced(): void {
    if (this._bumpTimer) clearTimeout(this._bumpTimer);
    this._bumpTimer = setTimeout(() => {
      this._bumpTree();
    }, 50);
  }
}
