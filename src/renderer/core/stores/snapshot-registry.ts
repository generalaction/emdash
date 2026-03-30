import { comparer, reaction } from 'mobx';
import { rpc } from '@renderer/core/ipc';

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
        // #region agent log
        fetch('http://127.0.0.1:7430/ingest/6ccbb4c2-4905-4756-889f-988f583bdf2f', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f1d8e3' },
          body: JSON.stringify({
            sessionId: 'f1d8e3',
            location: 'snapshot-registry:reaction',
            message: 'reaction fired, saving snapshot',
            data: { key, snapshot },
            timestamp: Date.now(),
            runId: 'run5',
            hypothesisId: 'F-G',
          }),
        }).catch(() => {});
        // #endregion
        rpc.viewState
          .save(key, snapshot)
          .then(() => {
            // #region agent log
            fetch('http://127.0.0.1:7430/ingest/6ccbb4c2-4905-4756-889f-988f583bdf2f', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f1d8e3' },
              body: JSON.stringify({
                sessionId: 'f1d8e3',
                location: 'snapshot-registry:save-resolved',
                message: 'rpc.viewState.save resolved',
                data: { key },
                timestamp: Date.now(),
                runId: 'run5',
                hypothesisId: 'I',
              }),
            }).catch(() => {});
            // #endregion
          })
          .catch((e) => {
            // #region agent log
            fetch('http://127.0.0.1:7430/ingest/6ccbb4c2-4905-4756-889f-988f583bdf2f', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f1d8e3' },
              body: JSON.stringify({
                sessionId: 'f1d8e3',
                location: 'snapshot-registry:save-error',
                message: 'rpc.viewState.save failed',
                data: { key, error: String(e) },
                timestamp: Date.now(),
                runId: 'run5',
                hypothesisId: 'G',
              }),
            }).catch(() => {});
            // #endregion
          });
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
