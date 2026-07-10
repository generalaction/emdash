import type { BoundExec } from '@emdash/core/exec';
import type { KeyedMutex } from '@emdash/core/lib';

export type GitRepositoryOptions = {
  gitCommonDir: string;
  objectStoreDir: string;
  exec: BoundExec;
  objectStoreMutex: KeyedMutex;
  onError?: (context: string, error: unknown) => void;
};
