import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { ResourceMap } from '../lib';
import { WatchService, realpathOrResolve, type IWatchService } from '../watch';
import { FileChanges } from './changes/changes';
import { enumerate as enumerateFiles } from './enumerate';
import type { FileError, FilesOnError } from './errors';
import { FileSystem } from './fs/file-system';
import type { FileTreeError, FileTreeOnError } from './tree/errors';
import { FileTree } from './tree/file-tree';
import type { FileTreeLease } from './tree/types';
import type {
  FileEnumeration,
  FileChangeSubscription,
  FileChangeUpdate,
  FileChangeWatchOptions,
  IFileSystem,
  IFilesRuntime,
} from './types';

export type FilesRuntimeOptions = {
  watcher?: IWatchService;
  onError?: FilesOnError & FileTreeOnError;
};

export class FilesRuntime implements IFilesRuntime {
  private readonly trees: ResourceMap<FileTree>;
  private readonly watcher: IWatchService;
  private readonly ownsWatcher: boolean;
  private disposeRequested = false;

  constructor(private readonly options: FilesRuntimeOptions = {}) {
    this.ownsWatcher = !options.watcher;
    this.watcher = options.watcher ?? new WatchService({ onError: options.onError });
    this.trees = new ResourceMap<FileTree>({
      teardown: (_key, tree) => tree.dispose(),
      onError: options.onError,
      onEmpty: () => {
        void this.disposeIfIdle();
      },
    });
  }

  async openTree(rootPath: string): Promise<Result<FileTreeLease, FileTreeError>> {
    if (this.disposeRequested) {
      return err({
        type: 'fs-error',
        path: '',
        message: 'FilesRuntime disposed',
      });
    }
    const resolvedRoot = realpathOrResolve(path.resolve(rootPath));
    const lease = await this.trees.acquire(resolvedRoot, async () => {
      return new FileTree({
        rootPath: resolvedRoot,
        watcher: this.watcher,
        onError: this.options.onError,
      });
    });
    try {
      const ready = await lease.value.ready();
      if (!ready.success) {
        await lease.release();
        return err(ready.error);
      }
      return ok(lease);
    } catch (error) {
      await lease.release();
      throw error;
    }
  }

  watchChanges(
    rootPath: string,
    cb: (update: FileChangeUpdate) => void,
    options?: FileChangeWatchOptions
  ): Result<FileChangeSubscription, FileError> {
    if (this.disposeRequested) {
      return err({
        type: 'fs-error',
        path: '',
        message: 'FilesRuntime disposed',
      });
    }
    const changes = new FileChanges({
      rootPath: realpathOrResolve(path.resolve(rootPath)),
      watcher: this.watcher,
      onError: this.options.onError,
    });
    const subscription = changes.watch(cb, options);
    if (!subscription.success) {
      changes.dispose();
      return subscription;
    }
    return ok({
      ready: subscription.data.ready,
      unsubscribe: () => {
        subscription.data.unsubscribe();
        changes.dispose();
      },
    });
  }

  enumerate(rootPath: string): Result<FileEnumeration, FileError> {
    if (this.disposeRequested) {
      return err({
        type: 'fs-error',
        path: '',
        message: 'FilesRuntime disposed',
      });
    }
    return ok(enumerateFiles(realpathOrResolve(path.resolve(rootPath))));
  }

  fileSystem(rootPath: string): Result<IFileSystem, FileError> {
    if (this.disposeRequested) {
      return err({
        type: 'fs-error',
        path: '',
        message: 'FilesRuntime disposed',
      });
    }
    return ok(new FileSystem(realpathOrResolve(path.resolve(rootPath))));
  }

  async dispose(): Promise<void> {
    this.disposeRequested = true;
    await this.trees.dispose();
    await this.disposeIfIdle();
  }

  private async disposeIfIdle(): Promise<void> {
    if (!this.disposeRequested || !this.trees.idle || !this.ownsWatcher) return;
    await this.watcher.dispose();
  }
}
