import type { BoundExec } from '@emdash/core/exec';
import { KeyedMutex } from '@emdash/core/lib';
import { WatchService, type IWatchService } from '@emdash/core/watch';
import { GitAllocationGraph } from './allocation/allocation-graph';
import { GitCheckoutRuntime } from './checkout/checkout-runtime';
import { createGitExec } from './exec/git-exec';
import { GitRepositoryProvisioner } from './repository/repository-provisioner';
import { GitRepositoryRuntime } from './repository/repository-runtime';

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

/** Host-scoped composition root for Git provisioning and canonical resource runtimes. */
export class GitRuntime {
  readonly provisioning: GitRepositoryProvisioner;
  readonly repository: GitRepositoryRuntime;
  readonly checkout: GitCheckoutRuntime;

  private readonly allocations: GitAllocationGraph;
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
    this.provisioning = new GitRepositoryProvisioner(exec);
    this.allocations = new GitAllocationGraph({
      exec,
      watcher: this.watcher,
      objectStoreMutex: new KeyedMutex(),
      idleTtlMs: options.idleTtlMs,
      aliasTtlMs: options.aliasTtlMs,
      maxFileDiffStates: options.maxFileDiffStates,
      onError,
    });
    this.repository = new GitRepositoryRuntime(this.allocations);
    this.checkout = new GitCheckoutRuntime(this.allocations);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.all([this.repository.dispose(), this.checkout.dispose()]);
    await this.allocations.dispose();
    if (this.ownsWatcher) await this.watcher.dispose();
  }
}
