import { err, ok, type Result, type Serializable } from '@emdash/shared';
import type { KeyValueStore } from '@primitives/kv/api';
import { operationInitiatorSchema } from '@primitives/operations/api';
import { z } from 'zod';
import {
  activateWorkspaceInputSchema,
  cleanWorkspaceArtifactsInputSchema,
  cleanWorkspaceArtifactsResultSchema,
  convertWorkspaceInputSchema,
  deactivateWorkspaceInputSchema,
  provisionWorkspaceInputSchema,
  teardownWorkspaceInputSchema,
  workspaceErrorSchema,
  workspaceKeySchema,
  workspaceOperationKindSchema,
  workspaceOperationProgressSchema,
  workspaceOperationResultSchema,
} from './schemas';

const STORE_KEY = 'workspace-operation-records';
const DEFAULT_NEXT_SEQ = 1;

export const workspaceOperationRecordStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'rejected',
  'cancelled',
  'suspended',
]);

export const workspaceOperationRecordInitiatorSchema = operationInitiatorSchema;

export const workspaceOperationRecordParamsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('provision'), input: provisionWorkspaceInputSchema }),
  z.object({ kind: z.literal('convert'), input: convertWorkspaceInputSchema }),
  z.object({ kind: z.literal('activate'), input: activateWorkspaceInputSchema }),
  z.object({ kind: z.literal('deactivate'), input: deactivateWorkspaceInputSchema }),
  z.object({ kind: z.literal('teardown'), input: teardownWorkspaceInputSchema }),
  z.object({ kind: z.literal('clean-artifacts'), input: cleanWorkspaceArtifactsInputSchema }),
]);

export const workspaceOperationRecordResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('provision'), data: workspaceOperationResultSchema }),
  z.object({ kind: z.literal('convert'), data: workspaceOperationResultSchema }),
  z.object({ kind: z.literal('activate'), data: workspaceOperationResultSchema }),
  z.object({ kind: z.literal('deactivate'), data: workspaceOperationResultSchema }),
  z.object({ kind: z.literal('teardown'), data: workspaceOperationResultSchema }),
  z.object({ kind: z.literal('clean-artifacts'), data: cleanWorkspaceArtifactsResultSchema }),
]);

export const workspaceOperationRecordSchema = z
  .object({
    requestId: z.string().min(1),
    seq: z.number().int().positive(),
    attempt: z.number().int().nonnegative(),
    kind: workspaceOperationKindSchema,
    workspace: workspaceKeySchema,
    params: workspaceOperationRecordParamsSchema,
    status: workspaceOperationRecordStatusSchema,
    suspendedCause: z.string().min(1).optional(),
    initiatedBy: workspaceOperationRecordInitiatorSchema.optional(),
    stages: workspaceOperationProgressSchema.optional(),
    result: workspaceOperationRecordResultSchema.optional(),
    error: workspaceErrorSchema.optional(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
    finishedAt: z.number().int().optional(),
  })
  .superRefine((record, ctx) => {
    if (record.params.kind !== record.kind) {
      ctx.addIssue({
        code: 'custom',
        path: ['params', 'kind'],
        message: 'Operation params kind must match record kind',
      });
    }
    if (record.result && record.result.kind !== record.kind) {
      ctx.addIssue({
        code: 'custom',
        path: ['result', 'kind'],
        message: 'Operation result kind must match record kind',
      });
    }
  });

export const workspaceOperationRecordMapSchema = z.record(
  z.string(),
  workspaceOperationRecordSchema
);

export const workspaceOperationRecordStoreStateSchema = z.object({
  nextSeq: z.number().int().positive(),
  records: workspaceOperationRecordMapSchema,
});

export const submitWorkspaceOperationInputSchema = z
  .object({
    requestId: z.string().min(1),
    kind: workspaceOperationKindSchema,
    workspace: workspaceKeySchema,
    params: workspaceOperationRecordParamsSchema,
    initiatedBy: workspaceOperationRecordInitiatorSchema.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.params.kind !== input.kind) {
      ctx.addIssue({
        code: 'custom',
        path: ['params', 'kind'],
        message: 'Operation params kind must match submitted kind',
      });
    }
  });

export const submitWorkspaceOperationOutcomeSchema = z.object({
  requestId: z.string().min(1),
  seq: z.number().int().positive(),
  outcome: z.enum(['accepted', 'duplicate']),
});

export const cancelWorkspaceOperationInputSchema = z.object({
  requestId: z.string().min(1),
});

export const cancelWorkspaceOperationResultSchema = z.object({
  requestId: z.string().min(1),
  status: workspaceOperationRecordStatusSchema,
});

export const workspaceOperationRecordErrorSchema = z.object({
  type: z.enum(['io', 'decode']),
  message: z.string(),
  key: z.string().optional(),
});

export type WorkspaceOperationRecordStatus = z.infer<typeof workspaceOperationRecordStatusSchema>;
export type WorkspaceOperationRecordParams = z.infer<typeof workspaceOperationRecordParamsSchema>;
export type WorkspaceOperationRecordResult = z.infer<typeof workspaceOperationRecordResultSchema>;
export type WorkspaceOperationRecord = z.infer<typeof workspaceOperationRecordSchema>;
export type WorkspaceOperationRecordMap = z.infer<typeof workspaceOperationRecordMapSchema>;
export type WorkspaceOperationRecordStoreState = z.infer<
  typeof workspaceOperationRecordStoreStateSchema
>;
export type SubmitWorkspaceOperationInput = z.infer<typeof submitWorkspaceOperationInputSchema>;
export type SubmitWorkspaceOperationOutcome = z.infer<typeof submitWorkspaceOperationOutcomeSchema>;
export type CancelWorkspaceOperationResult = z.infer<typeof cancelWorkspaceOperationResultSchema>;
export type WorkspaceOperationRecordError = z.infer<typeof workspaceOperationRecordErrorSchema>;

export type WorkspaceOperationRecordDraft = Pick<
  WorkspaceOperationRecord,
  'requestId' | 'kind' | 'workspace' | 'params'
> &
  Partial<
    Pick<
      WorkspaceOperationRecord,
      'status' | 'suspendedCause' | 'initiatedBy' | 'stages' | 'result' | 'error' | 'finishedAt'
    >
  >;

export type ReplaceWorkspaceOperationRecordInput = Pick<
  WorkspaceOperationRecord,
  'kind' | 'workspace' | 'params'
> &
  Partial<Pick<WorkspaceOperationRecord, 'initiatedBy'>>;

export type WorkspaceOperationRecordPatch = Partial<
  Pick<
    WorkspaceOperationRecord,
    'status' | 'suspendedCause' | 'stages' | 'result' | 'error' | 'finishedAt' | 'initiatedBy'
  >
>;

export type UpdateWorkspaceOperationRecordOptions = {
  expectStatus?: WorkspaceOperationRecordStatus[];
};

export type WorkspaceOperationRecordStatusConflict = {
  kind: 'status-conflict';
  record: WorkspaceOperationRecord;
};

export type WorkspaceOperationRecordUpdateResult =
  | WorkspaceOperationRecord
  | WorkspaceOperationRecordStatusConflict
  | null;

export type WorkspaceOperationRecordStore = {
  list(): Promise<Result<WorkspaceOperationRecord[], WorkspaceOperationRecordError>>;
  get(
    requestId: string
  ): Promise<Result<WorkspaceOperationRecord | null, WorkspaceOperationRecordError>>;
  appendRecord(
    input: WorkspaceOperationRecordDraft
  ): Promise<Result<WorkspaceOperationRecord, WorkspaceOperationRecordError>>;
  replaceRecord(
    requestId: string,
    input: ReplaceWorkspaceOperationRecordInput
  ): Promise<Result<WorkspaceOperationRecord | null, WorkspaceOperationRecordError>>;
  updateRecord(
    requestId: string,
    patch: WorkspaceOperationRecordPatch,
    options?: UpdateWorkspaceOperationRecordOptions
  ): Promise<Result<WorkspaceOperationRecordUpdateResult, WorkspaceOperationRecordError>>;
  removeRecord(requestId: string): Promise<Result<void, WorkspaceOperationRecordError>>;
  pruneTerminal(
    olderThanMs: number
  ): Promise<Result<WorkspaceOperationRecord[], WorkspaceOperationRecordError>>;
};

export type CreateWorkspaceOperationRecordStoreOptions = {
  now?: () => number;
};

export function createKvWorkspaceOperationRecordStore(
  store: KeyValueStore,
  options: CreateWorkspaceOperationRecordStoreOptions = {}
): WorkspaceOperationRecordStore {
  const now = options.now ?? Date.now;
  let mutationQueue = Promise.resolve();

  const enqueueMutation = <T>(
    operation: () => Promise<Result<T, WorkspaceOperationRecordError>>
  ): Promise<Result<T, WorkspaceOperationRecordError>> => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  return {
    async list() {
      const state = await loadState(store);
      if (!state.success) return state;
      return ok(sortRecords(Object.values(state.data.records)));
    },
    async get(requestId) {
      const state = await loadState(store);
      if (!state.success) return state;
      return ok(state.data.records[requestId] ?? null);
    },
    async appendRecord(input) {
      return enqueueMutation<WorkspaceOperationRecord>(async () => {
        const state = await loadState(store);
        if (!state.success) return state;
        const timestamp = now();
        const record = operationRecordFromDraft(input, state.data.nextSeq, 0, timestamp);
        const saved = await saveState(store, {
          nextSeq: state.data.nextSeq + 1,
          records: { ...state.data.records, [record.requestId]: record },
        });
        if (!saved.success) return saved;
        return ok(record);
      });
    },
    async replaceRecord(requestId, input) {
      return enqueueMutation<WorkspaceOperationRecord | null>(async () => {
        const state = await loadState(store);
        if (!state.success) return state;
        const existing = state.data.records[requestId];
        if (!existing) return ok(null);
        const next = compactRecord({
          requestId,
          seq: existing.seq,
          attempt: existing.attempt + 1,
          kind: input.kind,
          workspace: input.workspace,
          params: input.params,
          status: 'pending',
          initiatedBy: input.initiatedBy,
          createdAt: existing.createdAt,
          updatedAt: now(),
        });
        const saved = await saveState(store, {
          ...state.data,
          records: { ...state.data.records, [requestId]: next },
        });
        if (!saved.success) return saved;
        return ok(next);
      });
    },
    async updateRecord(requestId, patch, updateOptions) {
      return enqueueMutation<WorkspaceOperationRecordUpdateResult>(async () => {
        const state = await loadState(store);
        if (!state.success) return state;
        const existing = state.data.records[requestId];
        if (!existing) return ok(null);
        if (updateOptions?.expectStatus && !updateOptions.expectStatus.includes(existing.status)) {
          return ok({ kind: 'status-conflict', record: existing });
        }
        const next = compactRecord({ ...existing, ...patch, updatedAt: now() });
        const saved = await saveState(store, {
          ...state.data,
          records: { ...state.data.records, [requestId]: next },
        });
        if (!saved.success) return saved;
        return ok(next);
      });
    },
    async removeRecord(requestId) {
      return enqueueMutation(async () => {
        const state = await loadState(store);
        if (!state.success) return state;
        if (!state.data.records[requestId]) return ok();
        const records = { ...state.data.records };
        delete records[requestId];
        const saved = await saveState(store, { ...state.data, records });
        if (!saved.success) return saved;
        return ok();
      });
    },
    async pruneTerminal(olderThanMs) {
      return enqueueMutation(async () => {
        const state = await loadState(store);
        if (!state.success) return state;
        const cutoff = now() - olderThanMs;
        const records: WorkspaceOperationRecordMap = {};
        const pruned: WorkspaceOperationRecord[] = [];
        for (const record of Object.values(state.data.records)) {
          const finishedAt = record.finishedAt ?? record.updatedAt;
          if (isTerminalStatus(record.status) && finishedAt < cutoff) pruned.push(record);
          else records[record.requestId] = record;
        }
        if (pruned.length === 0) return ok([]);
        const saved = await saveState(store, { ...state.data, records });
        if (!saved.success) return saved;
        return ok(sortRecords(pruned));
      });
    },
  };
}

export function createMemoryWorkspaceOperationRecordStore(
  options: CreateWorkspaceOperationRecordStoreOptions = {}
): WorkspaceOperationRecordStore & { snapshot(): WorkspaceOperationRecordStoreState } {
  let state: WorkspaceOperationRecordStoreState = { nextSeq: DEFAULT_NEXT_SEQ, records: {} };
  const store: KeyValueStore = {
    async get(key) {
      return ok(key === STORE_KEY ? (state as unknown as Serializable) : null);
    },
    async set(key, value) {
      if (key === STORE_KEY) state = value as unknown as WorkspaceOperationRecordStoreState;
      return ok();
    },
    async delete(key) {
      if (key === STORE_KEY) state = { nextSeq: DEFAULT_NEXT_SEQ, records: {} };
      return ok();
    },
    async getAll() {
      return ok({ [STORE_KEY]: state as unknown as Serializable });
    },
  };
  return {
    ...createKvWorkspaceOperationRecordStore(store, options),
    snapshot() {
      return structuredClone(state);
    },
  };
}

export function isTerminalStatus(status: WorkspaceOperationRecordStatus): boolean {
  return (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'rejected' ||
    status === 'cancelled' ||
    status === 'suspended'
  );
}

export function isWorkspaceOperationRecordStatusConflict(
  result: WorkspaceOperationRecordUpdateResult
): result is WorkspaceOperationRecordStatusConflict {
  return result !== null && result.kind === 'status-conflict';
}

function operationRecordFromDraft(
  input: WorkspaceOperationRecordDraft,
  seq: number,
  attempt: number,
  timestamp: number
): WorkspaceOperationRecord {
  return compactRecord({
    requestId: input.requestId,
    seq,
    attempt,
    kind: input.kind,
    workspace: input.workspace,
    params: input.params,
    status: input.status ?? 'pending',
    suspendedCause: input.suspendedCause,
    initiatedBy: input.initiatedBy,
    stages: input.stages,
    result: input.result,
    error: input.error,
    createdAt: timestamp,
    updatedAt: timestamp,
    finishedAt: input.finishedAt,
  });
}

function sortRecords(records: Iterable<WorkspaceOperationRecord>): WorkspaceOperationRecord[] {
  return Array.from(records).sort((left, right) => left.seq - right.seq);
}

function compactRecord(record: WorkspaceOperationRecord): WorkspaceOperationRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  ) as WorkspaceOperationRecord;
}

async function loadState(
  store: KeyValueStore
): Promise<Result<WorkspaceOperationRecordStoreState, WorkspaceOperationRecordError>> {
  const loaded = await store.get(STORE_KEY);
  if (!loaded.success) return err(toWorkspaceOperationRecordError(loaded.error));
  if (loaded.data === null) return ok({ nextSeq: DEFAULT_NEXT_SEQ, records: {} });
  const parsed = workspaceOperationRecordStoreStateSchema.safeParse(loaded.data);
  if (!parsed.success) {
    return err({ type: 'decode', key: STORE_KEY, message: z.prettifyError(parsed.error) });
  }
  return ok(parsed.data);
}

async function saveState(
  store: KeyValueStore,
  state: WorkspaceOperationRecordStoreState
): Promise<Result<void, WorkspaceOperationRecordError>> {
  const saved = await store.set(STORE_KEY, state as unknown as Serializable);
  if (!saved.success) return err(toWorkspaceOperationRecordError(saved.error));
  return ok();
}

function toWorkspaceOperationRecordError(error: {
  message: string;
  key?: string;
}): WorkspaceOperationRecordError {
  return { type: 'io', message: error.message, key: error.key };
}
