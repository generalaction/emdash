import type { ContractDefinitions } from '../api';
import { spawnWorker, type WorkerHandle, type WorkerSpec } from './spawn-worker';

export type LazyWorkerOptions<Defs extends ContractDefinitions> = {
  onSpawned?: (handle: WorkerHandle<Defs>) => void | Promise<void>;
};

export type LazyWorker<Defs extends ContractDefinitions> = {
  get(): Promise<WorkerHandle<Defs>>;
  dispose(): Promise<void>;
};

export function lazyWorker<Defs extends ContractDefinitions>(
  spec: WorkerSpec<Defs> | (() => WorkerSpec<Defs>),
  options: LazyWorkerOptions<Defs> = {}
): LazyWorker<Defs> {
  let pending: Promise<WorkerHandle<Defs>> | null = null;

  return {
    get() {
      if (pending) return pending;
      pending = spawnWorker(typeof spec === 'function' ? spec() : spec)
        .then(async (handle) => {
          try {
            await options.onSpawned?.(handle);
          } catch (error) {
            await handle.dispose();
            throw error;
          }
          return handle;
        })
        .catch((error: unknown) => {
          pending = null;
          throw error;
        });
      return pending;
    },
    async dispose() {
      const current = pending;
      pending = null;
      const handle = await current?.catch(() => null);
      await handle?.dispose();
    },
  };
}
