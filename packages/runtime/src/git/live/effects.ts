import type { LiveCursor } from '@emdash/wire';
import type { CheckoutId, RepositoryId } from '../identity/types';

export type GitEffect =
  | { kind: 'repository-refs'; repositoryId: RepositoryId }
  | { kind: 'repository-remotes'; repositoryId: RepositoryId }
  | { kind: 'repository-stashes'; repositoryId: RepositoryId }
  | { kind: 'repository-worktrees'; repositoryId: RepositoryId }
  | { kind: 'checkout-head'; checkoutId: CheckoutId }
  | { kind: 'checkout-status'; checkoutId: CheckoutId }
  | { kind: 'file-diff'; checkoutId: CheckoutId; paths: 'all' | readonly string[] };

export type GitEffectPlan = Readonly<{
  settle: readonly GitEffect[];
  eager: readonly GitEffect[];
  background: readonly GitEffect[];
}>;

export type GitSettledState = Readonly<{
  name: 'refs' | 'remotes' | 'stashes' | 'worktrees' | 'status' | 'head';
  cursor: LiveCursor;
}>;
