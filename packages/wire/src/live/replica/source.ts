import type { Unsubscribe } from '@emdash/shared';
import type { ManagedSource } from '../../util/managed-source';
import type { LiveSource, LiveUpdate } from '../protocol';

export function managedLiveSource<K, T>(
  source: ManagedSource<K, T>,
  key: K,
  getSource: (value: T) => LiveSource
): LiveSource {
  return {
    async snapshot() {
      const lease = await source.acquire(key);
      try {
        return await getSource(await lease.ready()).snapshot();
      } finally {
        await lease.release();
      }
    },
    subscribe(cb: (update: LiveUpdate) => void): Unsubscribe {
      let disposed = false;
      let unsubscribe: Unsubscribe | undefined;
      const leasePromise = source.acquire(key);
      void leasePromise.ready().then((value) => {
        if (disposed) {
          void leasePromise.release();
          return;
        }
        unsubscribe = getSource(value).subscribe(cb);
      });
      return () => {
        disposed = true;
        unsubscribe?.();
        void leasePromise.release();
      };
    },
  };
}
