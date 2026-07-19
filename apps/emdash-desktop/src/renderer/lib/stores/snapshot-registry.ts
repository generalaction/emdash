import { comparer, reaction } from 'mobx';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { viewStateCache } from './view-state-cache';

export class SnapshotRegistry {
  private readonly disposers = new Map<string, () => void>();
  private readonly snapshots = new Map<string, () => unknown>();
  private readonly latestSnapshots = new Map<string, unknown>();
  private readonly pendingSaves = new Set<Promise<void>>();

  /**
   * Register an entity's snapshot with the registry.
   *
   * A MobX reaction is started that watches `getSnapshot()` and persists the
   * result via RPC whenever it structurally changes. Persistence is debounced
   * by one second by default, but callers can opt into immediate writes for
   * state that must survive a reload directly after user interaction.
   *
   * Call this AFTER restoring saved state so the initial value does not trigger
   * a spurious write (fireImmediately is false).
   *
   * @returns A disposer function — call it when the entity is torn down to stop
   *          the reaction and clean up the entry.
   */
  register(key: string, getSnapshot: () => unknown, delay = 1000): () => void {
    // Clean up any stale reaction for this key before creating a new one.
    this.disposers.get(key)?.();

    // Warm the cache with the current snapshot value immediately on register.
    const initialSnapshot = getSnapshot();
    viewStateCache.set(key, initialSnapshot);
    this.latestSnapshots.set(key, initialSnapshot);
    this.snapshots.set(key, getSnapshot);

    const reactionDisposer = reaction(
      () => getSnapshot(),
      (snapshot) => {
        viewStateCache.set(key, snapshot);
        this.latestSnapshots.set(key, snapshot);
        void this.save(key, snapshot).catch((error: unknown) => {
          log.error(`Failed to persist view state "${key}":`, error);
        });
      },
      { equals: comparer.structural, delay, fireImmediately: false }
    );

    const disposer = () => {
      reactionDisposer();
      if (this.disposers.get(key) !== disposer) return;
      this.disposers.delete(key);
      this.snapshots.delete(key);
    };
    this.disposers.set(key, disposer);

    return disposer;
  }

  evict(key: string): void {
    this.disposers.get(key)?.();
    this.latestSnapshots.delete(key);
    viewStateCache.delete(key);
  }

  async flush(): Promise<void> {
    await Promise.allSettled([...this.pendingSaves]);
    await Promise.all(
      [...this.latestSnapshots].map(([key, latestSnapshot]) => {
        const snapshot = this.snapshots.get(key)?.() ?? latestSnapshot;
        viewStateCache.set(key, snapshot);
        this.latestSnapshots.set(key, snapshot);
        return this.save(key, snapshot);
      })
    );
  }

  private save(key: string, snapshot: unknown): Promise<void> {
    const save = Promise.resolve(rpc.viewState.save(key, snapshot));
    this.pendingSaves.add(save);
    void save.then(
      () => this.pendingSaves.delete(save),
      () => this.pendingSaves.delete(save)
    );
    return save;
  }
}

export const snapshotRegistry = new SnapshotRegistry();
