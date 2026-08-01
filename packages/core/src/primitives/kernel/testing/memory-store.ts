import {
  canTransition,
  isTerminalStatus,
  type NewOperationRecord,
  type OperationRecord,
  type OperationRecordPatch,
  type OperationStatus,
  type OperationTransition,
  type TransitionCause,
} from '../api/record';
import type { ClaimWithHolder, OperationStore, OperationStoreTx } from '../api/store';

export interface MemoryOperationStoreOptions {
  nextSeq?: () => number;
  now?: () => number;
}

export class MemoryOperationStore implements OperationStore {
  private readonly records = new Map<string, OperationRecord>();
  private readonly transitions = new Map<string, OperationTransition[]>();
  private queue = Promise.resolve();
  private seq = 0;
  private activeTx = false;
  private readonly nextSeq: () => number;
  private readonly now: () => number;

  constructor(options: MemoryOperationStoreOptions = {}) {
    this.nextSeq = options.nextSeq ?? (() => ++this.seq);
    this.now = options.now ?? (() => Date.now());
  }

  async transaction<T>(fn: (tx: OperationStoreTx) => T | Promise<T>): Promise<T> {
    if (this.activeTx) {
      throw new Error('Nested OperationStore transactions are not supported');
    }
    const run = async () => {
      if (this.activeTx) {
        throw new Error('Nested OperationStore transactions are not supported');
      }
      const snapshot = this.capture();
      this.activeTx = true;
      try {
        return await fn(new MemoryOperationStoreTx(this));
      } catch (error) {
        this.restore(snapshot);
        throw error;
      } finally {
        this.activeTx = false;
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async listNonTerminal(): Promise<OperationRecord[]> {
    return this.snapshot((record) => !isTerminalStatus(record.status));
  }

  async listRecords(): Promise<OperationRecord[]> {
    return this.snapshot(() => true).sort((a, b) => a.seq - b.seq);
  }

  async listPending(): Promise<OperationRecord[]> {
    return this.snapshot((record) => record.status === 'pending').sort((a, b) => a.seq - b.seq);
  }

  async get(id: string): Promise<OperationRecord | undefined> {
    return cloneRecord(this.records.get(id));
  }

  async listByParent(parentId: string): Promise<OperationRecord[]> {
    return this.snapshot((record) => record.parentId === parentId).sort((a, b) => a.seq - b.seq);
  }

  async listTransitions(operationId: string): Promise<OperationTransition[]> {
    return [...(this.transitions.get(operationId) ?? [])];
  }

  insert(record: NewOperationRecord): OperationRecord {
    if (this.records.has(record.id)) {
      throw new Error(`Operation '${record.id}' already exists`);
    }

    const inserted = cloneDefinedRecord({ ...record, seq: this.nextSeq() });
    this.records.set(inserted.id, inserted);
    this.journal(inserted.id, inserted.status, inserted.status, 'submit');
    return cloneDefinedRecord(inserted);
  }

  transition(
    id: string,
    from: OperationStatus,
    to: OperationStatus,
    cause: TransitionCause,
    patch: OperationRecordPatch = {}
  ): boolean {
    const record = this.records.get(id);
    if (!record || record.status !== from || !canTransition(from, to)) {
      return false;
    }

    const next: OperationRecord = {
      ...record,
      ...patch,
      status: to,
    };
    this.records.set(id, cloneDefinedRecord(next));
    this.journal(id, from, to, cause);
    return true;
  }

  reparent(id: string, parentId: string): void {
    const record = this.records.get(id);
    if (!record) {
      throw new Error(`Operation '${id}' does not exist`);
    }
    const next = { ...record, parentId, updatedAt: this.now() };
    this.records.set(id, cloneDefinedRecord(next));
    this.journal(id, record.status, record.status, 'adoption');
  }

  listNonTerminalSync(): OperationRecord[] {
    return this.snapshot((record) => !isTerminalStatus(record.status));
  }

  listNonTerminalClaimsOnKeys(keys: readonly string[]): ClaimWithHolder[] {
    const keySet = new Set(keys);
    const rows: ClaimWithHolder[] = [];

    for (const record of this.records.values()) {
      if (isTerminalStatus(record.status)) {
        continue;
      }
      for (const claim of record.claims) {
        if (keySet.has(claim.key)) {
          rows.push({
            ...claim,
            holder: {
              id: record.id,
              name: record.name,
              key: record.key,
              status: record.status,
              parentId: record.parentId,
              seq: record.seq,
            },
          });
        }
      }
    }

    return rows;
  }

  getSync(id: string): OperationRecord | undefined {
    return cloneRecord(this.records.get(id));
  }

  listByParentSync(parentId: string): OperationRecord[] {
    return this.snapshot((record) => record.parentId === parentId).sort((a, b) => a.seq - b.seq);
  }

  private snapshot(predicate: (record: OperationRecord) => boolean): OperationRecord[] {
    return [...this.records.values()].filter(predicate).map((record) => cloneRecord(record)!);
  }

  private journal(
    operationId: string,
    from: OperationStatus,
    to: OperationStatus,
    cause: TransitionCause
  ): void {
    const rows = this.transitions.get(operationId) ?? [];
    rows.push({ operationId, from, to, at: this.now(), cause });
    this.transitions.set(operationId, rows);
  }

  private capture(): MemoryOperationStoreSnapshot {
    return {
      records: new Map(
        [...this.records.entries()].map(([id, record]) => [id, cloneDefinedRecord(record)])
      ),
      transitions: new Map(
        [...this.transitions.entries()].map(([id, transitions]) => [
          id,
          transitions.map((transition) => ({ ...transition })),
        ])
      ),
      seq: this.seq,
    };
  }

  private restore(snapshot: MemoryOperationStoreSnapshot): void {
    this.records.clear();
    for (const [id, record] of snapshot.records) {
      this.records.set(id, cloneDefinedRecord(record));
    }

    this.transitions.clear();
    for (const [id, transitions] of snapshot.transitions) {
      this.transitions.set(
        id,
        transitions.map((transition) => ({ ...transition }))
      );
    }

    this.seq = snapshot.seq;
  }
}

interface MemoryOperationStoreSnapshot {
  records: Map<string, OperationRecord>;
  transitions: Map<string, OperationTransition[]>;
  seq: number;
}

class MemoryOperationStoreTx implements OperationStoreTx {
  constructor(private readonly store: MemoryOperationStore) {}

  insert(record: NewOperationRecord): OperationRecord {
    return this.store.insert(record);
  }

  transition(
    id: string,
    from: OperationStatus,
    to: OperationStatus,
    cause: TransitionCause,
    patch?: OperationRecordPatch
  ): boolean {
    return this.store.transition(id, from, to, cause, patch);
  }

  reparent(id: string, parentId: string): void {
    this.store.reparent(id, parentId);
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

function cloneRecord(record: OperationRecord | undefined): OperationRecord | undefined {
  if (!record) {
    return undefined;
  }

  return cloneDefinedRecord(record);
}

function cloneDefinedRecord(record: OperationRecord): OperationRecord {
  return {
    ...record,
    claims: record.claims.map((claim) => ({ ...claim })),
  };
}
