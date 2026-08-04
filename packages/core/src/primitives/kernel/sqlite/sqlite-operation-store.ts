import type { SqliteConnection, StoreHandle } from '@primitives/sqlite-store/api';
import {
  canTransition,
  isTerminalStatus,
  operationOutcomeSummarySchema,
  type NewOperationRecord,
  type OperationRecord,
  type OperationRecordPatch,
  type OperationStatus,
  type OperationTransition,
  type TransitionCause,
  terminalStatuses,
} from '../api/record';
import type { ResourceClaim } from '../api/resources';
import type { ClaimWithHolder, OperationStore, OperationStoreTx } from '../api/store';
import type { OperationsDb } from './store';

export interface SqliteOperationStoreOptions {
  now?: () => number;
  onJournalAppend?: (transition: OperationTransition) => void;
}

type OperationRow = {
  seq: number;
  id: string;
  name: string;
  key: string;
  input: string;
  status: OperationStatus;
  attempt: number;
  not_before: number | null;
  parent_id: string | null;
  initiator: string;
  propagation: OperationRecord['propagation'] | null;
  result: string | null;
  rejected_error: string | null;
  error: string | null;
  outcome: string | null;
  created_at: number;
  updated_at: number;
};

type ClaimRow = ResourceClaim & {
  operation_id: string;
  implicit: boolean;
};

type TransitionRow = {
  operation_id: string;
  from_status: OperationStatus;
  to_status: OperationStatus;
  at: number;
  cause: TransitionCause;
};

export class SqliteOperationStore implements OperationStore {
  private activeTx = false;
  private readonly now: () => number;
  private readonly onJournalAppend?: (transition: OperationTransition) => void;

  constructor(
    private readonly handle: StoreHandle<OperationsDb>,
    options: SqliteOperationStoreOptions = {}
  ) {
    this.now = options.now ?? (() => Date.now());
    this.onJournalAppend = options.onJournalAppend;
  }

  async transaction<T>(fn: (tx: OperationStoreTx) => T | Promise<T>): Promise<T> {
    if (this.activeTx) {
      throw new Error('Nested OperationStore transactions are not supported');
    }

    const emitted: OperationTransition[] = [];
    this.activeTx = true;
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn(new SqliteOperationStoreTx(this, emitted));
      this.connection.exec('COMMIT');
      for (const transition of emitted) {
        this.onJournalAppend?.(transition);
      }
      return result;
    } catch (error) {
      try {
        this.connection.exec('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'SQLite transaction rollback failed');
      }
      throw error;
    } finally {
      this.activeTx = false;
    }
  }

  async listRecords(): Promise<OperationRecord[]> {
    return this.listRows('SELECT * FROM operations ORDER BY seq ASC');
  }

  async listNonTerminal(): Promise<OperationRecord[]> {
    return this.listRows(
      `SELECT * FROM operations WHERE status NOT IN (${terminalPlaceholders()}) ORDER BY seq ASC`,
      terminalStatusesParams()
    );
  }

  async listPending(): Promise<OperationRecord[]> {
    return this.listRows("SELECT * FROM operations WHERE status = 'pending' ORDER BY seq ASC");
  }

  async get(id: string): Promise<OperationRecord | undefined> {
    return this.getRecord(id);
  }

  async listByParent(parentId: string): Promise<OperationRecord[]> {
    return this.listRows('SELECT * FROM operations WHERE parent_id = ? ORDER BY seq ASC', [
      parentId,
    ]);
  }

  async listTransitions(operationId: string): Promise<OperationTransition[]> {
    return this.connection
      .all<TransitionRow>(
        'SELECT * FROM operation_transitions WHERE operation_id = ? ORDER BY rowid ASC',
        [operationId]
      )
      .map((row) => ({
        operationId: row.operation_id,
        from: row.from_status,
        to: row.to_status,
        at: row.at,
        cause: row.cause,
      }));
  }

  close(): void {
    this.handle.close();
  }

  insert(record: NewOperationRecord, emitted: OperationTransition[]): OperationRecord {
    const result = this.connection.run(
      `INSERT INTO operations (
        id, name, key, input, status, attempt, not_before, parent_id, initiator, propagation,
        result, rejected_error, error, outcome, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.name,
        record.key,
        encodeJson(record.input),
        record.status,
        record.attempt,
        record.notBefore ?? null,
        record.parentId ?? null,
        encodeJson(record.initiator),
        record.propagation ?? null,
        encodeOptionalJson(record.result),
        encodeOptionalJson(record.rejectedError),
        encodeOptionalJson(record.error),
        encodeOptionalJson(record.outcome),
        record.createdAt,
        record.updatedAt,
      ]
    );
    const seq = Number(result.lastInsertRowid);
    for (const claim of record.claims) {
      this.insertClaim(record.id, claim);
    }
    this.journal(record.id, record.status, record.status, 'submit', emitted);
    return { ...record, seq, claims: record.claims.map((claim) => ({ ...claim })) };
  }

  transition(
    id: string,
    from: OperationStatus,
    to: OperationStatus,
    cause: TransitionCause,
    patch: OperationRecordPatch,
    emitted: OperationTransition[]
  ): boolean {
    if (!canTransition(from, to)) {
      return false;
    }

    const assignments = ['status = ?'];
    const params: unknown[] = [to];
    if ('attempt' in patch) {
      assignments.push('attempt = ?');
      params.push(patch.attempt ?? null);
    }
    if ('notBefore' in patch) {
      assignments.push('not_before = ?');
      params.push(patch.notBefore ?? null);
    }
    if ('error' in patch) {
      assignments.push('error = ?');
      params.push(encodeOptionalJson(patch.error));
    }
    if ('outcome' in patch) {
      assignments.push('outcome = ?');
      params.push(encodeOptionalJson(patch.outcome));
    }
    if ('result' in patch) {
      assignments.push('result = ?');
      params.push(encodeOptionalJson(patch.result));
    }
    if ('rejectedError' in patch) {
      assignments.push('rejected_error = ?');
      params.push(encodeOptionalJson(patch.rejectedError));
    }
    if ('parentId' in patch) {
      assignments.push('parent_id = ?');
      params.push(patch.parentId ?? null);
    }
    if ('updatedAt' in patch) {
      assignments.push('updated_at = ?');
      params.push(patch.updatedAt ?? null);
    }
    params.push(id, from);
    const result = this.connection.run(
      `UPDATE operations SET ${assignments.join(', ')} WHERE id = ? AND status = ?`,
      params
    );
    if (Number(result.changes) === 0) {
      return false;
    }

    this.journal(id, from, to, cause, emitted);
    return true;
  }

  reparent(id: string, parentId: string, emitted: OperationTransition[]): void {
    const record = this.getRecord(id);
    if (!record) {
      throw new Error(`Operation '${id}' does not exist`);
    }
    this.connection.run('UPDATE operations SET parent_id = ?, updated_at = ? WHERE id = ?', [
      parentId,
      this.now(),
      id,
    ]);
    this.journal(id, record.status, record.status, 'adoption', emitted);
  }

  prune(ids: readonly string[]): void {
    if (ids.length === 0) {
      return;
    }

    const placeholders = ids.map(() => '?').join(', ');
    const records = this.connection.all<Pick<OperationRow, 'id' | 'status'>>(
      `SELECT id, status FROM operations WHERE id IN (${placeholders})`,
      ids
    );
    for (const record of records) {
      if (!isTerminalStatus(record.status)) {
        throw new Error(`Cannot prune non-terminal operation '${record.id}'`);
      }
    }

    this.connection.run(
      `DELETE FROM operation_claims WHERE operation_id IN (${placeholders})`,
      ids
    );
    this.connection.run(
      `DELETE FROM operation_transitions WHERE operation_id IN (${placeholders})`,
      ids
    );
    this.connection.run(`DELETE FROM operations WHERE id IN (${placeholders})`, ids);
  }

  listNonTerminalSync(): OperationRecord[] {
    return this.listRows(
      `SELECT * FROM operations WHERE status NOT IN (${terminalPlaceholders()}) ORDER BY seq ASC`,
      terminalStatusesParams()
    );
  }

  listNonTerminalClaimsOnKeys(keys: readonly string[]): ClaimWithHolder[] {
    if (keys.length === 0) {
      return [];
    }

    const placeholders = keys.map(() => '?').join(', ');
    return this.connection
      .all<
        ClaimRow & {
          holder_id: string;
          holder_name: string;
          holder_key: string;
          holder_status: OperationStatus;
          holder_parent_id: string | null;
          holder_seq: number;
        }
      >(
        `SELECT
          c.operation_id, c.resource, c.key, c.mode, c.implicit,
          o.id AS holder_id, o.name AS holder_name, o.key AS holder_key,
          o.status AS holder_status, o.parent_id AS holder_parent_id, o.seq AS holder_seq
        FROM operation_claims c
        JOIN operations o ON o.id = c.operation_id
        WHERE c.key IN (${placeholders})
          AND o.status NOT IN (${terminalPlaceholders()})
        ORDER BY o.seq ASC, c.rowid ASC`,
        [...keys, ...terminalStatusesParams()]
      )
      .map((row) => ({
        resource: row.resource,
        key: row.key,
        mode: row.mode,
        implicit: Boolean(row.implicit),
        holder: {
          id: row.holder_id,
          name: row.holder_name,
          key: row.holder_key,
          status: row.holder_status,
          parentId: row.holder_parent_id ?? undefined,
          seq: row.holder_seq,
        },
      }));
  }

  getSync(id: string): OperationRecord | undefined {
    return this.getRecord(id);
  }

  listByParentSync(parentId: string): OperationRecord[] {
    return this.listRows('SELECT * FROM operations WHERE parent_id = ? ORDER BY seq ASC', [
      parentId,
    ]);
  }

  private get connection(): SqliteConnection {
    return this.handle.connection;
  }

  private listRows(sql: string, params: readonly unknown[] = []): OperationRecord[] {
    const rows = this.connection.all<OperationRow>(sql, params);
    const claims = this.claimsFor(rows.map((row) => row.id));
    return rows.map((row) => decodeRecord(row, claims.get(row.id) ?? []));
  }

  private getRecord(id: string): OperationRecord | undefined {
    const row = this.connection.get<OperationRow>('SELECT * FROM operations WHERE id = ?', [id]);
    if (!row) {
      return undefined;
    }
    return decodeRecord(row, this.claimsFor([id]).get(id) ?? []);
  }

  private claimsFor(operationIds: readonly string[]): Map<string, ResourceClaim[]> {
    if (operationIds.length === 0) {
      return new Map();
    }

    const placeholders = operationIds.map(() => '?').join(', ');
    const claims = new Map<string, ResourceClaim[]>();
    for (const row of this.connection.all<ClaimRow>(
      `SELECT * FROM operation_claims WHERE operation_id IN (${placeholders}) ORDER BY rowid ASC`,
      operationIds
    )) {
      const rows = claims.get(row.operation_id) ?? [];
      rows.push({
        resource: row.resource,
        key: row.key,
        mode: row.mode,
        implicit: Boolean(row.implicit),
      });
      claims.set(row.operation_id, rows);
    }
    return claims;
  }

  private insertClaim(operationId: string, claim: ResourceClaim): void {
    this.connection.run(
      'INSERT INTO operation_claims (operation_id, resource, key, mode, implicit) VALUES (?, ?, ?, ?, ?)',
      [operationId, claim.resource, claim.key, claim.mode, claim.implicit ? 1 : 0]
    );
  }

  private journal(
    operationId: string,
    from: OperationStatus,
    to: OperationStatus,
    cause: TransitionCause,
    emitted: OperationTransition[]
  ): void {
    const transition = { operationId, from, to, at: this.now(), cause };
    this.connection.run(
      'INSERT INTO operation_transitions (operation_id, from_status, to_status, at, cause) VALUES (?, ?, ?, ?, ?)',
      [transition.operationId, transition.from, transition.to, transition.at, transition.cause]
    );
    emitted.push(transition);
  }
}

class SqliteOperationStoreTx implements OperationStoreTx {
  constructor(
    private readonly store: SqliteOperationStore,
    private readonly emitted: OperationTransition[]
  ) {}

  insert(record: NewOperationRecord): OperationRecord {
    return this.store.insert(record, this.emitted);
  }

  transition(
    id: string,
    from: OperationStatus,
    to: OperationStatus,
    cause: TransitionCause,
    patch: OperationRecordPatch = {}
  ): boolean {
    return this.store.transition(id, from, to, cause, patch, this.emitted);
  }

  reparent(id: string, parentId: string): void {
    this.store.reparent(id, parentId, this.emitted);
  }

  prune(ids: readonly string[]): void {
    this.store.prune(ids);
  }

  listNonTerminal(): OperationRecord[] {
    return this.store.listNonTerminalSync();
  }

  listNonTerminalClaimsOnKeys(keys: readonly string[]): ClaimWithHolder[] {
    return this.store.listNonTerminalClaimsOnKeys(keys);
  }

  get(id: string): OperationRecord | undefined {
    return this.store.getSync(id);
  }

  listByParent(parentId: string): OperationRecord[] {
    return this.store.listByParentSync(parentId);
  }
}

function decodeRecord(row: OperationRow, claims: ResourceClaim[]): OperationRecord {
  return {
    id: row.id,
    seq: row.seq,
    name: row.name,
    key: row.key,
    input: decodeJson(row.input),
    claims: claims.map((claim) => ({ ...claim })),
    status: row.status,
    attempt: row.attempt,
    notBefore: row.not_before ?? undefined,
    parentId: row.parent_id ?? undefined,
    initiator: decodeJson(row.initiator) as OperationRecord['initiator'],
    propagation: row.propagation ?? undefined,
    result: decodeOptionalJson(row.result),
    rejectedError: decodeOptionalJson(row.rejected_error),
    error: decodeOptionalJson(row.error) as OperationRecord['error'],
    outcome: decodeOutcome(row.outcome),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function encodeJson(value: unknown): string {
  return JSON.stringify(value);
}

function encodeOptionalJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function decodeJson(value: string): unknown {
  return JSON.parse(value);
}

function decodeOptionalJson(value: string | null): unknown {
  return value === null ? undefined : JSON.parse(value);
}

function decodeOutcome(value: string | null): OperationRecord['outcome'] {
  const decoded = decodeOptionalJson(value);
  if (decoded === undefined) return undefined;
  const parsed = operationOutcomeSummarySchema.safeParse(decoded);
  if (parsed.status !== 'ok') {
    throw new Error(`Stored operation outcome could not be parsed: ${parsed.status}`);
  }
  return parsed.data;
}

function terminalStatusesParams(): string[] {
  return [...terminalStatuses];
}

function terminalPlaceholders(): string {
  return terminalStatusesParams()
    .map(() => '?')
    .join(', ');
}
