import type { Lease, Result } from '@emdash/shared';
import type { LiveModelHost } from '@emdash/wire';
import type { EnsureRepositoryOptions } from './api/commands';
import type { CloneRepositoryError, EnsureRepositoryError } from './api/errors';
import type { GitPathInspection, GitRepositoryInfo } from './api/queries';
import type { CheckoutLiveEntry } from './checkout/live';
import type { IGitCheckout } from './checkout/types';
import type { gitCheckoutContract } from './checkout/contract';
import type { RepositoryLiveEntry } from './repository/live';
import type { IGitRepository } from './repository/types';
import type { gitRepositoryContract } from './repository/api/contract';
import type { GitOpContext } from './transfer-progress';

export type GitOnError = (context: string, error: unknown) => void;

export type RepoLease = Lease<IGitRepository>;

export type CheckoutLease = Lease<IGitCheckout>;

export type RepositoryLiveLease = Lease<RepositoryLiveEntry>;

export type CheckoutLiveLease = Lease<CheckoutLiveEntry>;

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

export interface IGitWireRuntime extends IGitRuntime {
  readonly repositoryHost: LiveModelHost<typeof gitRepositoryContract.model>;
  readonly checkoutHost: LiveModelHost<typeof gitCheckoutContract.model>;
  openRepositoryLive(pathInsideRepo: string): Promise<RepositoryLiveLease>;
  openCheckoutLive(checkoutPath: string): Promise<CheckoutLiveLease>;
}
