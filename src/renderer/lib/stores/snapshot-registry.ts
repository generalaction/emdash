import { comparer, reaction } from 'mobx';
import { rpc } from '@renderer/lib/ipc';

export class SnapshotRegistry {
  private readonly disposers = new Map<string, () => void>();

  /**
   * Register an entity's snapshot with the registry.
   *
   * A MobX reaction is started that watches `getSnapshot()` and persists the
   * result via RPC after a 1 second debounce whenever it structurally changes.
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

    const disposer = reaction(
      () => getSnapshot(),
      (snapshot) => {
        rpc.viewState.save(key, snapshot);
      },
      { equals: comparer.structural, delay: 1000, fireImmediately: false }
    );

    this.disposers.set(key, disposer);

    return () => {
      disposer();
      this.disposers.delete(key);
    };
  }
}

export const snapshotRegistry = new SnapshotRegistry();
