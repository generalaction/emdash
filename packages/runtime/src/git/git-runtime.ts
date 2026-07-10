import type { BoundExec } from '@emdash/core/exec';
import type {
  CheckoutSelector,
  CloneRepositoryError,
  EnsureRepositoryError,
  EnsureRepositoryOptions,
  GitPathInspection,
  GitRepositoryInfo,
  RepositorySelector,
} from '@emdash/core/git';
import { KeyedMutex } from '@emdash/core/lib';
import type { IWatchService } from '@emdash/core/services/fs-watch/api';
import { createNativeWatchService } from '@emdash/core/services/fs-watch/node';
import type { PendingLease, Result } from '@emdash/shared';
import { GitAllocationGraph } from './allocation/allocation-graph';
import type { CheckoutHandle, RepositoryHandle } from './allocation/handles';
import { createGitExec } from './exec/git-exec';
import type { GitOperationContext } from './exec/operation-context';
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
  private readonly provisioner: GitRepositoryProvisioner;
  private readonly allocations: GitAllocationGraph;
  private readonly watcher: IWatchService;
  private readonly ownsWatcher: boolean;
  private disposed = false;

  constructor(options: GitRuntimeOptions = {}) {
    const onError = options.onError ?? (() => {});
    this.ownsWatcher = !options.watcher;
    this.watcher = options.watcher ?? createNativeWatchService({ onError });
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

  inspectPath(path: string): Promise<GitPathInspection> {
    return this.provisioner.inspectPath(path);
  }

  ensureRepository(
    path: string,
    options?: EnsureRepositoryOptions
  ): Promise<Result<GitRepositoryInfo, EnsureRepositoryError>> {
    return this.provisioner.ensureRepository(path, options);
  }

  cloneRepository(
    repositoryUrl: string,
    targetPath: string,
    context?: GitOperationContext
  ): Promise<Result<GitRepositoryInfo, CloneRepositoryError>> {
    return this.provisioner.cloneRepository(repositoryUrl, targetPath, context);
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
