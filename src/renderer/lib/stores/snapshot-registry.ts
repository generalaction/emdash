import { comparer, reaction } from 'mobx';
import { rpc } from '@renderer/lib/ipc';
import { viewStateCache } from './view-state-cache';

export class SnapshotRegistry {
  private readonly disposers = new Map<string, () => void>();

  /**
   * Register an entity's snapshot with the registry.
   *
   * A MobX reaction is started that watches `getSnapshot()` and persists the
   * result via RPC after a 1 second debounce whenever it structurally changes.
   * The cache is updated immediately on every change so subsequent reads are
   * instant, and the entry is evicted from the cache when the disposer runs.
   *
   * Call this AFTER restoring saved state so the initial value does not trigger
   * a spurious write (fireImmediately is false).
   *
   * @returns A disposer function — call it when the entity is torn down to stop
   *          the reaction and clean up the entry.
   */
  register(key: string, getSnapshot: () => unknown): () => void {
    // Clean up any stale reaction for this key before creating a new one.
    this.disposers.get(key)?.();

    // Warm the cache with the current snapshot value immediately on register.
    viewStateCache.set(key, getSnapshot());

    const disposer = reaction(
      () => getSnapshot(),
      (snapshot) => {
        viewStateCache.set(key, snapshot);
        void rpc.viewState.save(key, snapshot);
      },
      { equals: comparer.structural, delay: 1000, fireImmediately: false }
    );

    this.disposers.set(key, disposer);

    return () => {
      disposer();
      viewStateCache.delete(key);
      this.disposers.delete(key);
    };
  }
}

export const snapshotRegistry = new SnapshotRegistry();
