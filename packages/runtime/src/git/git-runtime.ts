import type { BoundExec } from '@emdash/core/exec';
import type { CheckoutSelector, RepositorySelector } from '@emdash/core/git';
import { KeyedMutex } from '@emdash/core/lib';
import { WatchService, type IWatchService } from '@emdash/core/watch';
import type { PendingLease } from '@emdash/shared';
import { createGitExec } from './exec/git-env';
import { GitAllocationGraph } from './live/allocation-graph';
import type { CheckoutHandle, RepositoryHandle } from './live/allocation-graph';
import { GitRepositoryProvisioner } from './repository/repository-provisioner';

export type GitRuntimeOptions = Readonly<{
  watcher?: IWatchService;
  executable?: string;
  env?: NodeJS.ProcessEnv;
  exec?: BoundExec;
  idleTtlMs?: number;
  aliasTtlMs?: number;
  maxFileDiffStates?: number;
  onError?: (context: string, error: unknown) => void;
}>;

/** Host-scoped composition root for canonical Git mounts and selector-bound leases. */
export class GitRuntime {
  readonly provisioner: GitRepositoryProvisioner;
  readonly allocations: GitAllocationGraph;

  private readonly watcher: IWatchService;
  private readonly ownsWatcher: boolean;
  private disposed = false;

  constructor(options: GitRuntimeOptions = {}) {
    const onError = options.onError ?? (() => {});
    this.ownsWatcher = !options.watcher;
    this.watcher = options.watcher ?? new WatchService({ onError });
    const exec =
      options.exec ??
      createGitExec({ cwd: process.cwd(), executable: options.executable, env: options.env });
    this.provisioner = new GitRepositoryProvisioner(exec);
    this.allocations = new GitAllocationGraph({
      exec,
      watcher: this.watcher,
      objectStoreMutex: new KeyedMutex(),
      idleTtlMs: options.idleTtlMs,
      aliasTtlMs: options.aliasTtlMs,
      maxFileDiffStates: options.maxFileDiffStates,
      onError,
    });
  }

  acquireRepository(selector: RepositorySelector): PendingLease<RepositoryHandle> {
    return this.allocations.acquireRepository(selector);
  }

  acquireCheckout(selector: CheckoutSelector): PendingLease<CheckoutHandle> {
    return this.allocations.acquireCheckout(selector);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.allocations.dispose();
    if (this.ownsWatcher) await this.watcher.dispose();
  }
}
