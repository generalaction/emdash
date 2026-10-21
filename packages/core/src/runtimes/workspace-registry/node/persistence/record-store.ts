import { eq } from 'drizzle-orm';
import {
  createPathProfile,
  nativePathIdentityKey,
  stableNativePathDisplay,
  type PathProfile,
} from '#primitives/path/api';
import type { StoreHandle } from '#primitives/sqlite-store/api';
import type { PersonalProjectConfig, WorkspaceRecord } from '../../api/schemas';
import {
  parseCreateOutcomePayload,
  parseCreationPayload,
  parseGitObservationsPayload,
  parseLifecyclePayload,
  parsePersonalProjectConfigPayload,
  parseRemovalAttemptPayload,
  serializeCreateOutcomePayload,
  serializeCreationPayload,
  serializeGitObservationsPayload,
  serializeLifecyclePayload,
  serializePersonalProjectConfigPayload,
  serializeRemovalAttemptPayload,
} from './payload-codecs';
import { workspaceRecords } from './schema';
import type { WorkspaceRegistryDb } from './store';

type Row = typeof workspaceRecords.$inferSelect;
type RecordRow = Omit<Row, 'personalConfig' | 'legacyDesktopSettingsMigrated'>;

/**
 * A durable workspace record: everything on the wire record except the in-memory
 * runtime overlay, which the runtime merges in when publishing.
 */
/** The persisted row shape: no runtime overlay, no config-model projection. */
export type DurableWorkspaceRecord = Omit<WorkspaceRecord, 'runtime' | 'config'>;

export class WorkspaceRecordStore {
  private readonly profile: PathProfile;

  constructor(
    private readonly handle: StoreHandle<WorkspaceRegistryDb>,
    profile?: PathProfile
  ) {
    this.profile =
      profile ?? createPathProfile({ style: process.platform === 'win32' ? 'win32' : 'posix' });
  }

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
    return this.recordsAtPath(path)[0] ?? null;
  }

  recordsAtPath(path: string): DurableWorkspaceRecord[] {
    const key = this.pathKey(path);
    return this.list()
      .filter((record) => this.pathKey(record.path) === key)
      .sort(compareRecords);
  }

  pathsEqual(left: string, right: string): boolean {
    return this.pathKey(left) === this.pathKey(right);
  }

  pathKey(path: string): string {
    return nativePathIdentityKey(path, this.profile);
  }

  pathCollisions(): Array<{ key: string; records: DurableWorkspaceRecord[] }> {
    const byKey = new Map<string, DurableWorkspaceRecord[]>();
    for (const record of this.list()) {
      const key = this.pathKey(record.path);
      const records = byKey.get(key) ?? [];
      records.push(record);
      byKey.set(key, records);
    }
    return [...byKey.entries()]
      .filter(([, records]) => records.length > 1)
      .map(([key, records]) => ({ key, records: records.sort(compareRecords) }));
  }

  insert(record: DurableWorkspaceRecord): void {
    const conflicting = this.getByPath(record.path);
    if (conflicting && conflicting.id !== record.id) {
      throw pathCollision(record.path, record.id, conflicting.id);
    }
    this.handle.db
      .insert(workspaceRecords)
      .values({
        ...recordToRow(record),
        personalConfig: null,
        legacyDesktopSettingsMigrated: false,
      })
      .run();
  }

  update(record: DurableWorkspaceRecord): void {
    const current = this.get(record.id);
    const conflicting = this.getByPath(record.path);
    if (
      conflicting &&
      conflicting.id !== record.id &&
      (!current || !this.pathsEqual(current.path, record.path))
    ) {
      throw pathCollision(record.path, record.id, conflicting.id);
    }
    const persisted = current
      ? { ...record, path: stableNativePathDisplay(current.path, record.path, this.profile) }
      : record;
    const { id, ...columns } = recordToRow(persisted);
    this.handle.db.update(workspaceRecords).set(columns).where(eq(workspaceRecords.id, id)).run();
  }

  delete(id: string): boolean {
    const result = this.handle.db.delete(workspaceRecords).where(eq(workspaceRecords.id, id)).run();
    return result.changes > 0;
  }

  getPersonalConfig(repositoryId: string): PersonalProjectConfig {
    const row = this.handle.db
      .select({ personalConfig: workspaceRecords.personalConfig })
      .from(workspaceRecords)
      .where(eq(workspaceRecords.id, repositoryId))
      .get();
    return row?.personalConfig ? parsePersonalProjectConfigPayload(row.personalConfig) : {};
  }

  updatePersonalConfig(repositoryId: string, config: PersonalProjectConfig): void {
    this.handle.db
      .update(workspaceRecords)
      .set({ personalConfig: serializePersonalProjectConfigPayload(config) })
      .where(eq(workspaceRecords.id, repositoryId))
      .run();
  }

  hasMigratedLegacyDesktopSettings(repositoryId: string): boolean {
    const row = this.handle.db
      .select({ migrated: workspaceRecords.legacyDesktopSettingsMigrated })
      .from(workspaceRecords)
      .where(eq(workspaceRecords.id, repositoryId))
      .get();
    return row?.migrated === true;
  }

  importLegacyLifecycleSettings(repositoryId: string, personalConfig: PersonalProjectConfig): void {
    this.handle.db
      .update(workspaceRecords)
      .set({
        personalConfig: serializePersonalProjectConfigPayload(personalConfig),
        legacyDesktopSettingsMigrated: true,
      })
      .where(eq(workspaceRecords.id, repositoryId))
      .run();
  }
}

function compareRecords(left: DurableWorkspaceRecord, right: DurableWorkspaceRecord): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

function pathCollision(path: string, incomingId: string, conflictingId: string): Error {
  return new Error(
    `Workspace path identity collision at '${path}': '${incomingId}' conflicts with '${conflictingId}'`
  );
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

function recordToRow(record: DurableWorkspaceRecord): RecordRow {
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
