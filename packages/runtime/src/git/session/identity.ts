import type { BoundExec } from '@emdash/core/exec';
import type { KeyedMutex } from '@emdash/core/lib';
import type { IWatchService } from '@emdash/core/watch';

export type GitIdentity = {
  topLevel: string;
  gitDir: string;
  gitCommonDir: string;
  objectStoreDir: string;
};

export type GitOnError = (context: string, error: unknown) => void;

export type GitSessionManagerOptions = {
  exec: BoundExec;
  watcher: IWatchService;
  objectStoreMutex: KeyedMutex;
  onError?: GitOnError;
};
