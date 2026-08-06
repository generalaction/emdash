import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import {
  workspaces,
  type WorkspaceInsert,
  type WorkspaceRow,
} from '@core/services/app-db/node/schema';

type WorkspaceObservation = Readonly<{
  path?: string | null;
  observedStatus?: WorkspaceRow['observedStatus'];
  // Host registry observations (ADR 0005): pushed by the records sync, refreshed
  // wholesale. Structural facts (kind, parentId, origin, host identity) are host-owned
  // there too, so they refresh rather than annotate.
  kind?: WorkspaceRow['kind'];
  parentId?: string | null;
  origin?: WorkspaceRow['origin'];
  location?: WorkspaceRow['location'];
  sshConnectionId?: string | null;
  observedGit?: WorkspaceRow['observedGit'];
  lastCreateOutcome?: WorkspaceRow['lastCreateOutcome'];
  lastRemovalAttempt?: WorkspaceRow['lastRemovalAttempt'];
  scriptOutcomes?: WorkspaceRow['scriptOutcomes'];
  runtimeOverlay?: WorkspaceRow['runtimeOverlay'];
  lastActivatedAt?: number | null;
  observedAt?: number | null;
}>;

type WorkspaceAnnotation = Partial<
  Pick<
    WorkspaceInsert,
    'type' | 'kind' | 'location' | 'sshConnectionId' | 'parentId' | 'path' | 'config'
  >
>;

export type WorkspaceRegistryOptions = {
  now?: () => string;
};

export class WorkspaceRegistry {
  private readonly now: () => string;

  constructor(
    private readonly db: AppDb,
    options: WorkspaceRegistryOptions = {}
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  getLive(id: string, tx?: DrizzleTx): WorkspaceRow | undefined {
    const [row] = this.source(tx)
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.id, id), liveWorkspaces()))
      .limit(1)
      .all();
    return row;
  }

  findLiveByPath(
    location: NonNullable<WorkspaceRow['location']>,
    sshConnectionId: string | null,
    path: string,
    tx?: DrizzleTx
  ): WorkspaceRow | undefined {
    const hostIdentity =
      sshConnectionId === null
        ? isNull(workspaces.sshConnectionId)
        : eq(workspaces.sshConnectionId, sshConnectionId);
    return this.source(tx)
      .select()
      .from(workspaces)
      .where(
        and(
          eq(workspaces.location, location),
          hostIdentity,
          eq(workspaces.path, path),
          liveWorkspaces()
        )
      )
      .limit(1)
      .get();
  }

  register(values: WorkspaceInsert, tx?: DrizzleTx): WorkspaceRow {
    const now = this.now();
    return this.source(tx)
      .insert(workspaces)
      .values({
        ...values,
        createdAt: values.createdAt ?? now,
        updatedAt: values.updatedAt ?? now,
        untrackedAt: null,
      })
      .returning()
      .get();
  }

  adopt(values: WorkspaceInsert, tx?: DrizzleTx): WorkspaceRow {
    return this.register({ ...values, config: null }, tx);
  }

  refresh(id: string, observation: WorkspaceObservation, tx?: DrizzleTx): number {
    const { path, ...observed } = observation;
    return this.source(tx)
      .update(workspaces)
      .set({
        ...observed,
        ...(path !== undefined ? { path } : {}),
        updatedAt: this.now(),
      })
      .where(and(eq(workspaces.id, id), liveWorkspaces()))
      .run().changes;
  }

  annotate(id: string, annotation: WorkspaceAnnotation, tx?: DrizzleTx): number {
    return this.source(tx)
      .update(workspaces)
      .set({ ...annotation, updatedAt: this.now() })
      .where(eq(workspaces.id, id))
      .run().changes;
  }

  /**
   * Marks one live row with a durable deletion tombstone (ADR 0006). Atomic and
   * first-writer-wins: the guard on a null `deletionTombstone` makes zero rows updated
   * mean "already tombstoned" (or no longer live), so a UI double-fire never overwrites
   * the frozen options. The row stays live — the visible pending state.
   */
  tombstone(
    id: string,
    tombstone: NonNullable<WorkspaceRow['deletionTombstone']>,
    tx?: DrizzleTx
  ): number {
    return this.source(tx)
      .update(workspaces)
      .set({ deletionTombstone: tombstone, updatedAt: this.now() })
      .where(and(eq(workspaces.id, id), liveWorkspaces(), isNull(workspaces.deletionTombstone)))
      .run().changes;
  }

  untrack(
    ids: readonly string[],
    untrackedAt: string,
    observation?: Partial<Pick<WorkspaceObservation, 'observedStatus' | 'observedAt'>>,
    tx?: DrizzleTx
  ): number {
    if (ids.length === 0) return 0;
    return this.source(tx)
      .update(workspaces)
      .set({
        untrackedAt,
        ...observation,
        updatedAt: this.now(),
      })
      .where(and(inArray(workspaces.id, [...ids]), liveWorkspaces()))
      .run().changes;
  }

  revertUntrack(ids: readonly string[], tx?: DrizzleTx): number {
    if (ids.length === 0) return 0;
    return this.source(tx)
      .update(workspaces)
      .set({ untrackedAt: null, updatedAt: this.now() })
      .where(inArray(workspaces.id, [...ids]))
      .run().changes;
  }

  resurrect(id: string, tx?: DrizzleTx): number {
    return this.revertUntrack([id], tx);
  }

  purge(ids: readonly string[], tx?: DrizzleTx): number {
    if (ids.length === 0) return 0;
    const source = this.source(tx);
    const tracked = source
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(inArray(workspaces.id, [...ids]), liveWorkspaces()))
      .all();
    if (tracked.length > 0) {
      throw new Error(
        `Registry rows must be untracked before purge: ${tracked.map(({ id }) => id).join(', ')}`
      );
    }
    return source
      .delete(workspaces)
      .where(inArray(workspaces.id, [...ids]))
      .run().changes;
  }

  private source(tx?: DrizzleTx): AppDb {
    // AppDb and its transaction expose the same query-builder surface used by
    // this module; Drizzle does not publish a shared structural type for it.
    return (tx ?? this.db) as unknown as AppDb;
  }
}

export function createWorkspaceRegistry(
  db: AppDb,
  options?: WorkspaceRegistryOptions
): WorkspaceRegistry {
  return new WorkspaceRegistry(db, options);
}

export function liveWorkspaces(): SQL {
  return isNull(workspaces.untrackedAt);
}

export function isAnnotatedWorkspace(row: {
  config: unknown | null;
  hasTaskLink?: boolean;
  isProjectRepository?: boolean;
}): boolean {
  return row.config !== null || row.hasTaskLink === true || row.isProjectRepository === true;
}

/** Read-side table export. All mutations must go through `WorkspaceRegistry`. */
export const workspaceRegistryTable = workspaces;
