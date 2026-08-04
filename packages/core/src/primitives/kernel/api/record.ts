import { defineVersionedSchema } from '@primitives/versioned-schema/api';
import { z } from 'zod';
import type { ResourceClaim } from './resources';

export const operationStatuses = [
  'pending',
  'running',
  'waiting-children',
  'succeeded',
  'failed',
  'rejected',
  'cancelled',
  'superseded',
] as const;

export type OperationStatus = (typeof operationStatuses)[number];

export const terminalStatuses = [
  'succeeded',
  'failed',
  'rejected',
  'cancelled',
  'superseded',
] as const satisfies readonly OperationStatus[];

export type TerminalOperationStatus = (typeof terminalStatuses)[number];

const terminalStatusSet = new Set<OperationStatus>(terminalStatuses);

export function isTerminalStatus(status: OperationStatus): status is TerminalOperationStatus {
  return terminalStatusSet.has(status);
}

export const legalTransitions: Record<OperationStatus, readonly OperationStatus[]> = {
  pending: ['running', 'failed', 'cancelled', 'superseded'],
  running: [
    'pending',
    'waiting-children',
    'succeeded',
    'failed',
    'rejected',
    'cancelled',
    'superseded',
  ],
  'waiting-children': ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  rejected: [],
  cancelled: [],
  superseded: [],
};

export function canTransition(from: OperationStatus, to: OperationStatus): boolean {
  return legalTransitions[from].includes(to);
}

export type AbortReason = 'cancel' | 'supersede' | 'shutdown';

export type TransitionCause =
  | 'submit'
  | 'dispatch'
  | 'settle'
  | 'retry'
  | 'crash-reset'
  | 'shutdown'
  | 'cancel'
  | 'supersede'
  | 'adoption'
  | 'parent-settle'
  | 'parse-error';

export interface OperationTransition {
  operationId: string;
  from: OperationStatus;
  to: OperationStatus;
  at: number;
  cause: TransitionCause;
}

export type OperationInitiator =
  | { kind: 'user'; action: string }
  | { kind: 'operation'; operationId: string }
  | { kind: 'automation'; automationId: string }
  | { kind: 'reconciler'; probe: string };

export type PropagationPolicy = 'fail-parent' | 'tolerate';

export interface OperationErrorSummary {
  message: string;
  name?: string;
  stack?: string;
  code?: string;
}

const persistedOperationStageSchema: z.ZodType<PersistedOperationStage> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    status: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']),
    progress: z.number().min(0).max(1).optional(),
    error: z.object({ message: z.string() }).optional(),
    nonFatal: z.literal(true).optional(),
    substages: z.array(persistedOperationStageSchema).optional(),
  })
);

export interface PersistedOperationStage {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  progress?: number;
  error?: { message: string };
  nonFatal?: true;
  substages?: PersistedOperationStage[];
}

export const operationOutcomeSummarySchema = defineVersionedSchema()
  .initial(
    '1',
    z.object({
      version: z.literal('1'),
      failedStage: z.string().optional(),
      completedStages: z.array(z.string()),
      facts: z.record(z.string(), z.unknown()).optional(),
    })
  )
  .version(
    '2',
    z.object({
      version: z.literal('2'),
      stages: z.array(persistedOperationStageSchema),
      facts: z.record(z.string(), z.unknown()).optional(),
    }),
    (previous) => ({
      version: '2' as const,
      stages: [
        ...previous.completedStages.map((id) => ({
          id,
          label: id,
          status: 'succeeded' as const,
        })),
        ...(previous.failedStage && !previous.completedStages.includes(previous.failedStage)
          ? [
              {
                id: previous.failedStage,
                label: previous.failedStage,
                status: 'failed' as const,
              },
            ]
          : []),
      ],
      facts: previous.facts,
    })
  )
  .build();

export type OperationOutcomeSummary = typeof operationOutcomeSummarySchema.Type;

export interface OperationRecord {
  id: string;
  seq: number;
  name: string;
  key: string;
  input: unknown;
  claims: ResourceClaim[];

  status: OperationStatus;
  attempt: number;
  notBefore?: number;

  parentId?: string;
  initiator: OperationInitiator;
  propagation?: PropagationPolicy;

  result?: unknown;
  rejectedError?: unknown;
  error?: OperationErrorSummary;
  outcome?: OperationOutcomeSummary;

  createdAt: number;
  updatedAt: number;
}

export type NewOperationRecord = Omit<OperationRecord, 'seq'>;

export type OperationRecordPatch = Partial<
  Pick<
    OperationRecord,
    | 'attempt'
    | 'notBefore'
    | 'error'
    | 'outcome'
    | 'result'
    | 'rejectedError'
    | 'parentId'
    | 'updatedAt'
  >
>;

export function errorSummaryFromUnknown(error: unknown): OperationErrorSummary {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}
