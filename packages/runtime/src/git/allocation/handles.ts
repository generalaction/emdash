import type { BoundFileDiffKey, CheckoutSelector, RepositorySelector } from '@emdash/core/git';
import type { Result } from '@emdash/shared';
import type { GitCheckout } from '../checkout/git-checkout';
import type { GitRepository } from '../repository/git-repository';
import type { CheckoutMount, CheckoutStateName } from './checkout-mount';
import type { CheckoutOperation, RepositoryOperation } from './effect-plan';
import type { CheckoutId, RepositoryId } from './identity';
import type { GitExecution, RepositoryMount, RepositoryStateName } from './repository-mount';

export class RepositoryHandle {
  readonly id: RepositoryId;

  constructor(
    readonly selector: RepositorySelector,
    private readonly mount: RepositoryMount
  ) {
    this.id = mount.identity.repositoryId;
  }

  state(name: RepositoryStateName) {
    return this.mount.state(name);
  }

  query<T>(read: (repository: GitRepository) => Promise<T>): Promise<T> {
    return this.mount.query(read);
  }

  mutate<T, E>(
    operation: RepositoryOperation,
    mutationId: string | undefined,
    run: (repository: GitRepository) => Promise<Result<T, E>>,
    options?: { objectTransfer?: boolean }
  ): Promise<GitExecution<T, E>> {
    return this.mount.mutate(operation, mutationId, run, options);
  }

  runJob<T, E>(
    operation: RepositoryOperation,
    run: (repository: GitRepository) => Promise<Result<T, E>>,
    options?: { objectTransfer?: boolean }
  ): Promise<Result<T, E>> {
    return this.mount.runJob(operation, run, options);
  }
}

export class CheckoutHandle {
  readonly id: CheckoutId;
  readonly repositoryId: RepositoryId;

  constructor(
    readonly selector: CheckoutSelector,
    private readonly mount: CheckoutMount
  ) {
    this.id = mount.identity.checkoutId;
    this.repositoryId = mount.identity.repositoryId;
  }

  state(name: CheckoutStateName) {
    return this.mount.state(name);
  }

  acquireFileDiffStaleness(key: BoundFileDiffKey) {
    return this.mount.acquireFileDiffStaleness(key);
  }

  query<T>(read: (checkout: GitCheckout) => Promise<T>): Promise<T> {
    return this.mount.query(read);
  }

  mutate<T, E>(
    operation: CheckoutOperation,
    paths: 'all' | readonly string[],
    mutationId: string | undefined,
    run: (checkout: GitCheckout) => Promise<Result<T, E>>,
    options?: { objectTransfer?: boolean }
  ): Promise<GitExecution<T, E>> {
    return this.mount.mutate(operation, paths, mutationId, run, options);
  }

  runJob<T, E>(
    operation: CheckoutOperation,
    run: (checkout: GitCheckout) => Promise<Result<T, E>>,
    options?: { objectTransfer?: boolean }
  ): Promise<Result<T, E>> {
    return this.mount.runJob(operation, run, options);
  }
}
