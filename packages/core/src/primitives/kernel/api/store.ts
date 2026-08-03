import type {
  NewOperationRecord,
  OperationRecord,
  OperationRecordPatch,
  OperationStatus,
  OperationTransition,
  TransitionCause,
} from './record';
import type { ResourceClaim } from './resources';

export interface ClaimWithHolder extends ResourceClaim {
  holder: Pick<OperationRecord, 'id' | 'name' | 'key' | 'status' | 'parentId' | 'seq'>;
}

export interface OperationStore {
  transaction<T>(fn: (tx: OperationStoreTx) => T | Promise<T>): Promise<T>;
  listRecords(): Promise<OperationRecord[]>;
  listNonTerminal(): Promise<OperationRecord[]>;
  listPending(): Promise<OperationRecord[]>;
  get(id: string): Promise<OperationRecord | undefined>;
  listByParent(parentId: string): Promise<OperationRecord[]>;
  listTransitions(operationId: string): Promise<OperationTransition[]>;
}

export interface OperationStoreTx {
  insert(record: NewOperationRecord): OperationRecord;
  transition(
    id: string,
    from: OperationStatus,
    to: OperationStatus,
    cause: TransitionCause,
    patch?: OperationRecordPatch
  ): boolean;
  reparent(id: string, parentId: string): void;
  prune(ids: readonly string[]): void;
  listNonTerminal(): OperationRecord[];
  listNonTerminalClaimsOnKeys(keys: readonly string[]): ClaimWithHolder[];
  get(id: string): OperationRecord | undefined;
  listByParent(parentId: string): OperationRecord[];
}
