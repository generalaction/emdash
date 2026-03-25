import { action, makeObservable, observable, runInAction } from 'mobx';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { FileNode, FileWatchEvent } from '@shared/fs';
import { events, rpc } from '@renderer/core/ipc';
import { isExcluded, makeNode, sortedChildPaths } from '@renderer/core/stores/files-store-utils';

export class FilesStore {
  // Non-observable imperative maps — generation drives reactive re-renders.
  readonly nodes = new Map<string, FileNode>();
  readonly childIndex = new Map<string | null, string[]>();
  readonly loadedPaths = new Set<string>();
  readonly pendingPaths = new Set<string>();

  isLoading = false;
  error: string | undefined = undefined;
  generation = 0;

  private _unsubscribe: (() => void) | null = null;
  private _bumpTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly projectId: string,
    private readonly taskId: string
  ) {
    makeObservable(this, {
      isLoading: observable,
      error: observable,
      generation: observable,
      loadRoot: action,
      loadDir: action,
      applyWatchEvents: action,
    });
  }

  private bump(): void {
    this.generation++;
  }

  private bumpDebounced(): void {
    if (this._bumpTimer) clearTimeout(this._bumpTimer);
    this._bumpTimer = setTimeout(() => {
      runInAction(() => this.bump());
    }, 50);
  }

  private addNode(node: FileNode): void {
    this.nodes.set(node.path, node);
    const parent = node.parentPath;
    const existing = this.childIndex.get(parent) ?? [];
    if (!existing.includes(node.path)) {
      this.childIndex.set(parent, sortedChildPaths([...existing, node.path], this.nodes));
    }
  }

  private removeNode(path: string): void {
    const node = this.nodes.get(path);
    if (!node) return;

    const siblings = this.childIndex.get(node.parentPath) ?? [];
    this.childIndex.set(
      node.parentPath,
      siblings.filter((p) => p !== path)
    );

    const toRemove: string[] = [path];
    while (toRemove.length) {
      const p = toRemove.pop()!;
      this.nodes.delete(p);
      this.loadedPaths.delete(p);
      const children = this.childIndex.get(p) ?? [];
      toRemove.push(...children);
      this.childIndex.delete(p);
    }
  }

  private applyEntries(
    dirPath: string,
    entries: Array<{ path: string; type: 'file' | 'dir'; mtime?: Date }>
  ): void {
    const affectedParents = new Set<string | null>();

    for (const entry of entries) {
      if (isExcluded(entry.path)) continue;
      const node = makeNode(entry.path, entry.type === 'dir' ? 'directory' : 'file', entry.mtime);

      this.nodes.set(node.path, node);

      const parent = node.parentPath;
      const siblings = this.childIndex.get(parent) ?? [];
      if (!siblings.includes(node.path)) {
        siblings.push(node.path);
        this.childIndex.set(parent, siblings);
      }
      affectedParents.add(parent);
    }

    for (const parent of affectedParents) {
      const children = this.childIndex.get(parent);
      if (children) {
        this.childIndex.set(parent, sortedChildPaths(children, this.nodes));
      }
    }

    this.loadedPaths.add(dirPath);
  }

  async loadDir(dirPath: string, force = false): Promise<void> {
    if (!force && (this.loadedPaths.has(dirPath) || this.pendingPaths.has(dirPath))) return;
    this.pendingPaths.add(dirPath);

    try {
      const result = await rpc.fs.listFiles(this.projectId, this.taskId, dirPath || '.', {
        recursive: false,
        includeHidden: true,
      });

      if (!result.success) {
        if (dirPath === '') {
          runInAction(() => {
            this.error = 'Failed to load files';
            this.isLoading = false;
          });
        }
        return;
      }

      this.applyEntries(dirPath, result.data.entries);

      runInAction(() => {
        if (dirPath === '') {
          this.error = undefined;
          this.isLoading = false;
          this.bump();
        } else {
          this.bumpDebounced();
        }
      });

      for (const entry of result.data.entries) {
        if (entry.type === 'dir' && !isExcluded(entry.path)) {
          void this.loadDir(entry.path);
        }
      }
    } catch (e) {
      if (dirPath === '') {
        runInAction(() => {
          this.error = e instanceof Error ? e.message : 'Failed to load files';
          this.isLoading = false;
        });
      }
    } finally {
      this.pendingPaths.delete(dirPath);
    }
  }

  async loadRoot(): Promise<void> {
    runInAction(() => {
      this.isLoading = true;
      this.error = undefined;
    });
    await this.loadDir('');
  }

  async revealFile(filePath: string, expandedPaths: Set<string>): Promise<void> {
    const parts = filePath.split('/').filter(Boolean);
    const dirs: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      dirs.push(parts.slice(0, i).join('/'));
    }

    for (const dir of dirs) {
      await this.loadDir(dir);
    }

    runInAction(() => {
      for (const dir of dirs) expandedPaths.add(dir);
      this.bump();
    });
  }

  applyWatchEvents(watchEvents: FileWatchEvent[]): void {
    let changed = false;

    for (const evt of watchEvents) {
      if (isExcluded(evt.path)) continue;

      if (evt.type === 'create') {
        const node = makeNode(evt.path, evt.entryType);
        const parentLoaded = this.loadedPaths.has(node.parentPath ?? '');
        if (parentLoaded && !this.nodes.has(evt.path)) {
          this.addNode(node);
          changed = true;
        }
      } else if (evt.type === 'delete') {
        if (this.nodes.has(evt.path)) {
          this.removeNode(evt.path);
          changed = true;
        }
      } else if (evt.type === 'modify') {
        const existing = this.nodes.get(evt.path);
        if (existing) {
          this.nodes.set(evt.path, { ...existing, mtime: new Date() });
          changed = true;
        }
      } else if (evt.type === 'rename' && evt.oldPath) {
        if (this.nodes.has(evt.oldPath)) {
          this.removeNode(evt.oldPath);
          changed = true;
        }
        const node = makeNode(evt.path, evt.entryType);
        const parentLoaded = this.loadedPaths.has(node.parentPath ?? '');
        if (parentLoaded) {
          this.addNode(node);
          changed = true;
        }
      }
    }

    if (changed) {
      this.bump();
    }
  }

  startWatching(): void {
    rpc.fs.watchSetPaths(this.projectId, this.taskId, [''], 'filetree').catch(() => {});

    this._unsubscribe = events.on(
      fsWatchEventChannel,
      (data) => this.applyWatchEvents(data.events),
      this.taskId
    );
  }

  dispose(): void {
    if (this._bumpTimer) {
      clearTimeout(this._bumpTimer);
      this._bumpTimer = null;
    }
    this._unsubscribe?.();
    this._unsubscribe = null;
    rpc.fs.watchStop(this.projectId, this.taskId, 'filetree').catch(() => {});
  }
}
