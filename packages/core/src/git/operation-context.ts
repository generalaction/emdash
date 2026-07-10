import type { GitTransferProgress } from './api/schemas';

export type GitOpContext<P = GitTransferProgress> = {
  signal?: AbortSignal;
  onProgress?: (progress: P) => void;
};
