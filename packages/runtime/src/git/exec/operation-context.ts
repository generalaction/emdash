import type { GitTransferProgress } from '@emdash/core/git';

export type GitOperationContext<P = GitTransferProgress> = Readonly<{
  signal?: AbortSignal;
  onProgress?: (progress: P) => void;
}>;
