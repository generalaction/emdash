import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { WorkspaceObservedData } from '@core/primitives/workspaces/api';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import {
  workspaces,
  type WorkspaceInsert,
  type WorkspaceRow,
} from '@core/services/app-db/node/schema';

type WorkspaceObservation = Readonly<{
  path?: string | null;
  observedStatus?: WorkspaceRow['observedStatus'];
  observedGitBranch?: string | null;
  observedData?: WorkspaceObservedData | null;
  lastObservedAt: string;
}>;

type WorkspaceAnnotation = Partial<
  Pick<
    WorkspaceInsert,
    | 'key'
    | 'type'
    | 'kind'
    | 'location'
    | 'sshConnectionId'
    | 'parentId'
    | 'data'
    | 'path'
    | 'config'
    | 'branchName'
    | 'linesAdded'
    | 'linesDeleted'
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

  findLiveByKey(key: string, tx?: DrizzleTx): WorkspaceRow | undefined {
    const [row] = this.source(tx)
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.key, key), liveWorkspaces()))
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

  untrack(
    ids: readonly string[],
    untrackedAt: string,
    observation?: Partial<
      Pick<WorkspaceObservation, 'observedStatus' | 'lastObservedAt' | 'observedData'>
    >,
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
