import type { Lease, Result } from '@emdash/shared';
import type { EnsureRepositoryOptions } from './api/commands';
import type { CloneRepositoryError, EnsureRepositoryError } from './api/errors';
import type { GitPathInspection, GitRepositoryInfo } from './api/queries';
import type { IGitCheckout } from './checkout/types';
import type { IGitRepository } from './repository/types';
import type { GitOpContext } from './transfer-progress';

export type GitOnError = (context: string, error: unknown) => void;

export type RepoLease = Lease<IGitRepository>;

export type CheckoutLease = Lease<IGitCheckout>;
export interface IGitRuntime {
  inspectPath(path: string): Promise<GitPathInspection>;
  ensureRepository(
    path: string,
    options?: EnsureRepositoryOptions
  ): Promise<Result<GitRepositoryInfo, EnsureRepositoryError>>;
  cloneRepository(
    repositoryUrl: string,
    targetPath: string,
    context?: GitOpContext
  ): Promise<Result<GitRepositoryInfo, CloneRepositoryError>>;
  openRepository(pathInsideRepo: string): Promise<RepoLease>;
  openCheckout(checkoutPath: string): Promise<CheckoutLease>;
  dispose(): Promise<void>;
}
