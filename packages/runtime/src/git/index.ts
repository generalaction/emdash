export {
  createGitContractImpl,
  createGitController,
  type GitControllerOptions,
} from './api/controller';
export { GitCheckout } from './checkout/git-checkout';
export type { GitObjectReader } from './checkout/types';
export { GitRuntime, type GitRuntimeOptions } from './git-runtime';
export {
  CanonicalGitIdentityResolver,
  type CanonicalGitIdentityResolverOptions,
} from './identity/resolver';
export type {
  CheckoutId,
  CheckoutIdentity,
  GitIdentityResolver,
  GitResolutionError,
  ObjectStoreId,
  RepositoryId,
  RepositoryIdentity,
} from './identity/types';
export {
  CheckoutHandle,
  GitAllocationGraph,
  GitResolutionException,
  RepositoryHandle,
  type GitAllocationGraphOptions,
} from './live/allocation-graph';
export { CheckoutMount, type CheckoutStateName } from './live/checkout-mount';
export {
  effectPlanFor,
  type CheckoutOperation,
  type GitEffectContext,
  type GitOperation,
  type RepositoryOperation,
} from './live/effect-policy';
export type { GitEffect, GitEffectPlan, GitSettledState } from './live/effects';
export { FileDiffRegistry, type FileDiffRegistryOptions } from './live/file-diff-registry';
export {
  RepositoryMount,
  type GitExecution,
  type RepositoryStateName,
} from './live/repository-mount';
export type { GitOperationContext, GitOpContext } from './operation-context';
export { GitRepository } from './repository/git-repository';
export { GitRepositoryProvisioner } from './repository/repository-provisioner';
export { GitWireAdapter } from './wire/contract-adapter';
