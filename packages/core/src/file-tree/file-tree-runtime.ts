import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { FileWatchService, realpathOrResolve, type IFileWatchService } from '../fs';
import { ResourceMap } from '../lib';
import type { FileTreeError, FileTreeOnError } from './errors';
import { FileTree } from './file-tree';
import type { FileTreeLease, IFileTreeRuntime } from './types';

export type FileTreeRuntimeOptions = {
  watcher?: IFileWatchService;
  onError?: FileTreeOnError;
};

export class FileTreeRuntime implements IFileTreeRuntime {
  private readonly trees: ResourceMap<FileTree>;
  private readonly watcher: IFileWatchService;
  private readonly ownsWatcher: boolean;
  private disposeRequested = false;

  constructor(private readonly options: FileTreeRuntimeOptions = {}) {
    this.ownsWatcher = !options.watcher;
    this.watcher = options.watcher ?? new FileWatchService({ onError: options.onError });
    this.trees = new ResourceMap<FileTree>({
      teardown: (_key, tree) => tree.dispose(),
      onError: options.onError,
      onEmpty: () => {
        void this.disposeIfIdle();
      },
    });
  }

  async open(rootPath: string): Promise<Result<FileTreeLease, FileTreeError>> {
    if (this.disposeRequested) throw new Error('FileTreeRuntime disposed');
    const resolvedRoot = realpathOrResolve(path.resolve(rootPath));
    const lease = await this.trees.acquire(resolvedRoot, async () => {
      const tree = new FileTree({
        rootPath: resolvedRoot,
        watcher: this.watcher,
        onError: this.options.onError,
      });
      return tree;
    });
    try {
      const ready = await lease.value.ready();
      if (!ready.success) {
        lease.release();
        return err(ready.error);
      }
      return ok(lease);
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  async dispose(): Promise<void> {
    this.disposeRequested = true;
    this.trees.dispose();
    await this.disposeIfIdle();
  }

  private async disposeIfIdle(): Promise<void> {
    if (!this.disposeRequested || !this.trees.idle || !this.ownsWatcher) return;
    await this.watcher.dispose();
  }
}
