import type { Unsubscribe } from '@emdash/shared';
import { KeyedMutex } from '@primitives/lib/api';
import type { PortableRelativePath } from '@primitives/path/api';
import type { RootIdentity } from '@runtimes/files/node/allocation/identity';
import { RootPathPolicy, normalizeRelativePath } from '@runtimes/files/node/fs/path-policy';
import type { IWatchService, WatchHandle } from '@services/fs-watch/api';

const WATCH_DEBOUNCE_MS = 50;

export type RootChange =
  | { kind: 'create' | 'update' | 'delete'; path: PortableRelativePath }
  | { kind: 'resync' };

export type RootResourceOptions = {
  identity: RootIdentity;
  watcher: IWatchService;
};

export class RootResource {
  readonly identity: RootIdentity;
  readonly paths: RootPathPolicy;

  private readonly listeners = new Set<(changes: RootChange[]) => void>();
  private readonly mutationMutex = new KeyedMutex();
  private readonly watch: WatchHandle;
  private disposed = false;

  static async create(options: RootResourceOptions): Promise<RootResource> {
    const resource = new RootResource(options);
    try {
      await resource.watch.ready();
      return resource;
    } catch (error) {
      await resource.dispose();
      throw error;
    }
  }

  private constructor(options: RootResourceOptions) {
    this.identity = options.identity;
    this.paths = new RootPathPolicy(options.identity.rootPath);
    this.watch = options.watcher.watch(
      options.identity.rootPath,
      (events) => {
        const changes = events.flatMap((event): RootChange[] => {
          const relative = this.paths.toRelative(event.path);
          return relative === null ? [] : [{ kind: event.kind, path: relative }];
        });
        this.emit(changes);
      },
      {
        debounceMs: WATCH_DEBOUNCE_MS,
        onResync: () => this.emit([{ kind: 'resync' }]),
      }
    );
  }

  subscribe(listener: (changes: RootChange[]) => void): Unsubscribe {
    if (this.disposed) throw new Error('RootResource is disposed');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publishKnownChanges(changes: RootChange[]): void {
    const accepted = changes.flatMap((change): RootChange[] => {
      if (change.kind === 'resync') return [change];
      return normalizeRelativePath(change.path).success ? [change] : [];
    });
    this.emit(accepted);
  }

  runFileMutation<T>(resolvedPath: string, run: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new Error('RootResource is disposed');
    return this.mutationMutex.runExclusive(resolvedPath, run);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    await this.watch.release();
  }

  private emit(changes: RootChange[]): void {
    if (this.disposed || changes.length === 0) return;
    for (const listener of [...this.listeners]) listener(changes);
  }
}
