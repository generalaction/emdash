import type { BoundExec } from '../../exec';
import type { KeyedMutex } from '../../lib';
import type { IWatchService } from '../../watch';

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
