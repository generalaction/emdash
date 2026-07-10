import type { GitTransferProgress } from '@emdash/core/git';

export type GitOperationContext<P = GitTransferProgress> = Readonly<{
  signal?: AbortSignal;
  onProgress?: (progress: P) => void;
}>;

/** Temporary name retained for callers migrating from @emdash/core/git. */
export type GitOpContext<P = GitTransferProgress> = GitOperationContext<P>;
