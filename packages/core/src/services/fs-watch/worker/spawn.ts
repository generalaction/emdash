import { createScope, type Scope } from '@emdash/wire/util';
import {
  createWireWorkerHost,
  type WorkerProcessSpawner,
  type WorkerSupervision,
} from '@emdash/wire/worker';
import { childProcessSpawner } from '@emdash/wire/worker/node';
import type { IWatchService } from '../api';
import { fsWatchContract } from '../api';
import type { WatchBackend } from '../impl/backend';
import { processWatchBackend } from '../impl/process-backend';
import { createWatchService } from '../impl/watch-service';

export type SpawnFsWatchWorkerOptions = {
  entry: string;
  scope?: Scope;
  env?: Record<string, string | undefined>;
  processSpawner?: WorkerProcessSpawner;
  supervision?: WorkerSupervision;
  onError?: (context: string, error: unknown) => void;
};

export function spawnFsWatchWorker(options: SpawnFsWatchWorkerOptions): IWatchService {
  const scope = options.scope ?? createScope({ label: 'fs-watch-process-service' });
  const workerHost = createWireWorkerHost({
    scope: scope.child('fs-watch-worker-host'),
    processSpawner: options.processSpawner ?? childProcessSpawner(),
  });
  const worker = workerHost.define({
    name: 'fs-watch',
    contract: fsWatchContract,
    supervision: options.supervision,
    process: () => ({
      entry: options.entry,
      env: options.env,
    }),
  });
  const backend: WatchBackend = {
    ...processWatchBackend({
      client: worker.client,
      ready: () => worker.ready(),
      onError: options.onError,
    }),
    async dispose() {
      await workerHost.dispose();
      if (!options.scope) await scope.dispose();
    },
  };
  return createWatchService({
    backend,
    scope,
    graceMs: 2_500,
    onError: options.onError,
  });
}
