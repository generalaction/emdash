import type { MementoCatalogEntry } from '@core/primitives/mementos/api';

/**
 * Composition-root registry for persisted mementos.
 *
 * Definitions remain colocated with their owning feature and are imported here.
 * The worker uses this catalog for retention policies; the renderer uses it for
 * subject-level prefetch.
 */
export const mementoCatalog: readonly MementoCatalogEntry[] = [];

export const mementoSweepPolicies = mementoCatalog.flatMap((definition) =>
  definition.retention.tier === 'persisted'
    ? [
        {
          mementoId: definition.id,
          maxAge: definition.retention.maxAge,
          maxEntries: definition.retention.maxEntries,
        },
      ]
    : []
);
