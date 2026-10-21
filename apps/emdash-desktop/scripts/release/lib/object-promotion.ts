export interface ObjectPromotionEntry<T> {
  key: string;
  value: T;
}

export interface ObjectPromotionStore<T> {
  read(key: string): Promise<T | null>;
  write(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export type ObjectPromotionSnapshot<T> = ReadonlyMap<string, T | null>;

export interface ObjectPromotionOptions<T> {
  rollbackSnapshot?: ObjectPromotionSnapshot<T>;
}

/**
 * Signals that the external commit may have succeeded but cannot be confirmed. In that state the
 * new, internally consistent object set is retained so a retry can inspect and reconcile it.
 */
export class PromotionCommitUncertainError extends Error {}

export async function snapshotPromotionObjects<T>(
  entries: readonly ObjectPromotionEntry<T>[],
  store: ObjectPromotionStore<T>
): Promise<Map<string, T | null>> {
  const snapshot = new Map<string, T | null>();
  for (const { key } of entries) snapshot.set(key, await store.read(key));
  return snapshot;
}

export async function restorePromotionSnapshot<T>(
  entries: readonly ObjectPromotionEntry<T>[],
  store: ObjectPromotionStore<T>,
  snapshot: ObjectPromotionSnapshot<T>
): Promise<void> {
  const rollbackErrors: unknown[] = [];
  for (const { key } of [...entries].reverse()) {
    try {
      if (!snapshot.has(key)) throw new Error(`Rollback snapshot is missing promotion key: ${key}`);
      const value = snapshot.get(key);
      if (value === null || value === undefined) await store.remove(key);
      else await store.write(key, value);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
  }
  if (rollbackErrors.length > 0) {
    throw new AggregateError(rollbackErrors, 'Could not restore the complete promotion snapshot');
  }
}

/**
 * Snapshots every mutable object before writing any of them, promotes the complete desired set,
 * and rolls the set back if promotion or the external commit fails. Immutable staging should be
 * completed before calling this function.
 */
export async function promoteObjectsWithRollback<T>(
  entries: readonly ObjectPromotionEntry<T>[],
  store: ObjectPromotionStore<T>,
  commit: () => Promise<void>,
  options: ObjectPromotionOptions<T> = {}
): Promise<void> {
  const keys = new Set<string>();
  for (const { key } of entries) {
    if (keys.has(key)) throw new Error(`Duplicate promotion key: ${key}`);
    keys.add(key);
  }

  const previous = options.rollbackSnapshot ?? (await snapshotPromotionObjects(entries, store));
  for (const { key } of entries) {
    if (!previous.has(key)) throw new Error(`Rollback snapshot is missing promotion key: ${key}`);
  }

  try {
    for (const { key, value } of entries) await store.write(key, value);
    await commit();
  } catch (error) {
    if (error instanceof PromotionCommitUncertainError) throw error;

    try {
      await restorePromotionSnapshot(entries, store, previous);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Object promotion failed and rollback was incomplete'
      );
    }
    throw error;
  }
}
