import { eq } from 'drizzle-orm';
import type { StoreHandle } from '#primitives/sqlite-store/api';
import type { WorkspaceRecord } from '../../api/schemas';
import {
  parseCreateOutcomePayload,
  parseCreationPayload,
  parseGitObservationsPayload,
  parseLifecyclePayload,
  parseRemovalAttemptPayload,
  serializeCreateOutcomePayload,
  serializeCreationPayload,
  serializeGitObservationsPayload,
  serializeLifecyclePayload,
  serializeRemovalAttemptPayload,
} from './payload-codecs';
import { workspaceRecords } from './schema';
import type { WorkspaceRegistryDb } from './store';

type Row = typeof workspaceRecords.$inferSelect;

/**
 * A durable workspace record: everything on the wire record except the in-memory
 * runtime overlay, which the runtime merges in when publishing.
 */
/** The persisted row shape: no runtime overlay, no config-model projection. */
export type DurableWorkspaceRecord = Omit<WorkspaceRecord, 'runtime' | 'config'>;

export class WorkspaceRecordStore {
  constructor(private readonly handle: StoreHandle<WorkspaceRegistryDb>) {}

  list(): DurableWorkspaceRecord[] {
    return this.handle.db.select().from(workspaceRecords).all().map(rowToRecord);
  }

  get(id: string): DurableWorkspaceRecord | null {
    const row = this.handle.db
      .select()
      .from(workspaceRecords)
      .where(eq(workspaceRecords.id, id))
      .get();
    return row ? rowToRecord(row) : null;
  }

  getByPath(path: string): DurableWorkspaceRecord | null {
    const row = this.handle.db
      .select()
      .from(workspaceRecords)
      .where(eq(workspaceRecords.path, path))
      .get();
    return row ? rowToRecord(row) : null;
  }

  insert(record: DurableWorkspaceRecord): void {
    this.handle.db.insert(workspaceRecords).values(recordToRow(record)).run();
  }

  update(record: DurableWorkspaceRecord): void {
    const { id, ...columns } = recordToRow(record);
    this.handle.db.update(workspaceRecords).set(columns).where(eq(workspaceRecords.id, id)).run();
  }

  delete(id: string): boolean {
    const result = this.handle.db.delete(workspaceRecords).where(eq(workspaceRecords.id, id)).run();
    return result.changes > 0;
  }
}

function rowToRecord(row: Row): DurableWorkspaceRecord {
  return {
    id: row.id,
    kind: row.kind,
    path: row.path,
    parentId: row.parentId,
    origin: row.origin,
    gitAdminName: row.gitAdminName,
    observedStatus: row.observedStatus,
    creation: row.creation === null ? null : parseCreationPayload(row.creation),
    lastCreateOutcome:
      row.lastCreateOutcome === null ? null : parseCreateOutcomePayload(row.lastCreateOutcome),
    // The background column stores the lifecycle payload (v1 rows upgrade in the codec).
    lifecycle: row.background === null ? null : parseLifecyclePayload(row.background),
    lastRemovalAttempt:
      row.lastRemovalAttempt === null ? null : parseRemovalAttemptPayload(row.lastRemovalAttempt),
    git: row.git === null ? null : parseGitObservationsPayload(row.git),
    lastActivatedAt: row.lastActivatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastObservedAt: row.lastObservedAt,
  };
}

function recordToRow(record: DurableWorkspaceRecord): Row {
  return {
    id: record.id,
    kind: record.kind,
    path: record.path,
    parentId: record.parentId,
    origin: record.origin,
    gitAdminName: record.gitAdminName,
    observedStatus: record.observedStatus,
    creation: record.creation === null ? null : serializeCreationPayload(record.creation),
    lastCreateOutcome:
      record.lastCreateOutcome === null
        ? null
        : serializeCreateOutcomePayload(record.lastCreateOutcome),
    background: record.lifecycle === null ? null : serializeLifecyclePayload(record.lifecycle),
    lastRemovalAttempt:
      record.lastRemovalAttempt === null
        ? null
        : serializeRemovalAttemptPayload(record.lastRemovalAttempt),
    // Retired: script runs live as lifecycle steps now; the column stays but is unfed.
    scriptOutcomes: null,
    git: record.git === null ? null : serializeGitObservationsPayload(record.git),
    lastActivatedAt: record.lastActivatedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastObservedAt: record.lastObservedAt,
  };
}
