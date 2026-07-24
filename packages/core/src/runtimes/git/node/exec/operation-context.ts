import type { GitTransferProgress } from '@runtimes/git/api';

export type GitOperationContext<P = GitTransferProgress> = Readonly<{
  signal?: AbortSignal;
  onProgress?: (progress: P) => void;
}>;
