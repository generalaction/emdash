import type { ContractDefinitions } from '../api';
import { createSharedResource } from '../util/shared-resource';
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
  const resource = createSharedResource<WorkerHandle<Defs>>({
    label: 'lazy-worker',
    create: async (scope) => {
      const handle = await spawnWorker(typeof spec === 'function' ? spec() : spec);
      scope.add(() => handle.dispose());
      return handle;
    },
  });
  let lease: ReturnType<typeof resource.acquire> | null = null;
  let pending: Promise<WorkerHandle<Defs>> | null = null;

  return {
    get() {
      if (pending) return pending;
      const acquired = resource.acquire();
      lease = acquired;
      pending = acquired
        .ready()
        .then(async (handle) => {
          try {
            await options.onSpawned?.(handle);
          } catch (error) {
            await acquired.release();
            throw error;
          }
          return handle;
        })
        .catch((error: unknown) => {
          if (lease === acquired) lease = null;
          pending = null;
          throw error;
        });
      return pending;
    },
    async dispose() {
      const currentLease = lease;
      const currentPending = pending;
      lease = null;
      pending = null;
      await currentLease?.release();
      await currentPending?.catch(() => null);
      await resource.dispose();
    },
  };
}
