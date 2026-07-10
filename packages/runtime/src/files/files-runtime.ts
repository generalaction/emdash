import { WatchService, type IWatchService } from '@emdash/core/watch';
import { FilesAllocationGraph } from './allocation/allocation-graph';
import { FileContentRuntime } from './content/content-runtime';
import { FileSystemRuntime } from './fs/file-system';
import { FileTreeRuntime } from './tree/tree-runtime';

export type FilesRuntimeOptions = {
  watcher?: IWatchService;
  idleTtlMs?: number;
  maxContentBytes?: number;
  onError?: (context: string, error: unknown) => void;
};

export class FilesRuntime {
  readonly fs: FileSystemRuntime;
  readonly tree: FileTreeRuntime;
  readonly content: FileContentRuntime;

  private readonly allocations: FilesAllocationGraph;
  private readonly watcher: IWatchService;
  private readonly ownsWatcher: boolean;
  private disposed = false;

  constructor(options: FilesRuntimeOptions = {}) {
    const onError = options.onError ?? (() => {});
    this.ownsWatcher = options.watcher === undefined;
    this.watcher = options.watcher ?? new WatchService({ onError });
    this.allocations = new FilesAllocationGraph({
      watcher: this.watcher,
      idleTtlMs: options.idleTtlMs,
      maxContentBytes: options.maxContentBytes,
      onError,
    });
    this.fs = new FileSystemRuntime(this.allocations);
    this.tree = new FileTreeRuntime(this.allocations);
    this.content = new FileContentRuntime(this.allocations);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.all([this.content.dispose(), this.tree.dispose()]);
    await this.allocations.dispose();
    if (this.ownsWatcher) await this.watcher.dispose();
  }
}
