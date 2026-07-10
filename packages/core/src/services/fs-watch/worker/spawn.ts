import type { ManagedProcess, ProcessHost } from '@emdash/wire/process';
import type { Scope } from '@emdash/wire/util';
import type { IWatchService } from '../api';
import { processWatchBackend } from '../impl/process-backend';
import { createWatchService } from '../impl/watch-service';

export type SpawnFsWatchWorkerOptions = {
  entry: string;
  scope?: Scope;
  host?: ProcessHost;
  env?: Record<string, string | undefined>;
  onError?: (context: string, error: unknown) => void;
  onProcess?: (process: ManagedProcess) => void;
};

export function spawnFsWatchWorker(options: SpawnFsWatchWorkerOptions): IWatchService {
  return createWatchService({
    backend: processWatchBackend({
      entry: options.entry,
      host: options.host,
      env: options.env,
      onError: options.onError,
      onProcess: options.onProcess,
    }),
    scope: options.scope,
    graceMs: 2_500,
    onError: options.onError,
  });
}
