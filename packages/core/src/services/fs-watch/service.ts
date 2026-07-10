import type { ManagedProcess, ProcessHost } from '@emdash/wire/process';
import type { Scope } from '@emdash/wire/util';
import { nativeWatchBackend, type WatchOnError } from './backend';
import { processWatchBackend } from './process-backend';
import type { IWatchService } from './types';
import { createWatchService } from './watch-service';

export type CreateFsWatchServiceOptions = {
  /** Built child entry. Omit to run the native watcher in-process. */
  entry?: string;
  scope?: Scope;
  host?: ProcessHost;
  env?: Record<string, string | undefined>;
  onError?: WatchOnError;
  onProcess?: (process: ManagedProcess) => void;
};

export function createFsWatchService(options: CreateFsWatchServiceOptions = {}): IWatchService {
  const backend = options.entry
    ? processWatchBackend({
        entry: options.entry,
        host: options.host,
        env: options.env,
        onError: options.onError,
        onProcess: options.onProcess,
      })
    : nativeWatchBackend({ onError: options.onError });

  return createWatchService({
    backend,
    scope: options.scope,
    graceMs: options.entry ? 2_500 : 0,
    onError: options.onError,
  });
}
