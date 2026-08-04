import z from 'zod';
import { defineVersionedSchema } from '@shared/lib/versioned-schema/versioned-schema';

const boundedIdSchema = z.string().trim().min(1).max(256);
const boundedPathSchema = z.string().trim().min(1).max(4096);
const boundedMessageSchema = z.string().max(4096);
const timestampSchema = z.string().trim().min(1).max(64);

/** Fixed product policy for one clean-room E2E phase, including interrupted/recovered runs. */
export const CLEAN_ROOM_E2E_MAX_ATTEMPTS = 25;
/** Bounded hostile-result authority retained and cancelled for one session-start boundary. */
export const CLEAN_ROOM_E2E_MAX_REPORTED_SESSION_ATTEMPTS = 64;
/** One outer identity, one preallocated nested identity, and every bounded reported actual. */
export const CLEAN_ROOM_E2E_MAX_SESSION_RECORDS_PER_ATTEMPT =
  CLEAN_ROOM_E2E_MAX_REPORTED_SESSION_ATTEMPTS + 2;
/** Bounded ledger capacity, including non-E2E work and review history. */
export const CLEAN_ROOM_MAX_DURABLE_SESSION_ATTEMPTS = 1_674;

export const loopCommitSchema = z
  .string()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i, 'Expected a full Git object ID');

export const loopMachineSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local') }).strict(),
  z
    .object({
      kind: z.literal('ssh'),
      connectionId: boundedIdSchema,
    })
    .strict(),
]);

export const loopSessionTargetSchema = z
  .object({
    workspaceId: boundedIdSchema,
    path: boundedPathSchema,
    machine: loopMachineSchema,
  })
  .strict();

export const LOOP_SESSION_PURPOSES = ['work', 'review', 'browser-verification', 'e2e'] as const;
export const LOOP_SESSION_ATTEMPT_STATUSES = [
  'starting',
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;

export const loopSessionPurposeSchema = z.enum(LOOP_SESSION_PURPOSES);
export const loopSessionAttemptStatusSchema = z.enum(LOOP_SESSION_ATTEMPT_STATUSES);

export const loopSessionAttemptSchema = z
  .object({
    attemptId: boundedIdSchema,
    conversationId: boundedIdSchema,
    purpose: loopSessionPurposeSchema,
    phaseId: boundedIdSchema.optional(),
    verificationRunId: boundedIdSchema.optional(),
    target: loopSessionTargetSchema,
    status: loopSessionAttemptStatusSchema,
    checkpointBefore: loopCommitSchema.optional(),
    checkpointAfter: loopCommitSchema.optional(),
    startedAt: timestampSchema,
    finishedAt: timestampSchema.optional(),
    error: boundedMessageSchema.optional(),
  })
  .strict();

export const LOOP_VERIFICATION_WORKSPACE_STATUSES = [
  'preparing',
  'ready',
  'running',
  'integrating-fix',
  'destroying',
  'cleanup-failed',
] as const;
export const LOOP_CLEANUP_STATUSES = [
  'not-required',
  'pending',
  'running',
  'completed',
  'failed',
] as const;

export const loopCleanupStateSchema = z
  .object({
    status: z.enum(LOOP_CLEANUP_STATUSES),
    updatedAt: timestampSchema,
    error: boundedMessageSchema.optional(),
  })
  .strict();

export const loopVerificationWorkspaceStateSchema = z
  .object({
    verificationRunId: boundedIdSchema,
    attempt: z.number().int().positive(),
    status: z.enum(LOOP_VERIFICATION_WORKSPACE_STATUSES),
    target: loopSessionTargetSchema.optional(),
    baseCommit: loopCommitSchema,
    replayedThroughCommit: loopCommitSchema.optional(),
    expectedFeatureHead: loopCommitSchema,
    cleanup: loopCleanupStateSchema,
  })
  .strict();

export const loopStateV1Schema = z
  .object({
    version: z.literal('1'),
    baseCommit: loopCommitSchema.nullable(),
    expectedFeatureHead: loopCommitSchema.nullable(),
    checkpointCommit: loopCommitSchema.nullable(),
    sessionAttempts: z.array(loopSessionAttemptSchema).max(CLEAN_ROOM_MAX_DURABLE_SESSION_ATTEMPTS),
    verification: loopVerificationWorkspaceStateSchema.nullable(),
  })
  .strict()
  .superRefine((state, ctx) => {
    const attemptIds = new Set<string>();
    const conversationIds = new Set<string>();
    for (const [index, attempt] of state.sessionAttempts.entries()) {
      if (attemptIds.has(attempt.attemptId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sessionAttempts', index, 'attemptId'],
          message: 'Session attempt IDs must be append-only and unique',
        });
      }
      if (conversationIds.has(attempt.conversationId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sessionAttempts', index, 'conversationId'],
          message: 'Each fresh Loop session must have a unique conversation ID',
        });
      }
      attemptIds.add(attempt.attemptId);
      conversationIds.add(attempt.conversationId);
    }
  });

export const loopStateV2Schema = z
  .object({
    version: z.literal('2'),
    baseCommit: loopCommitSchema.nullable(),
    expectedFeatureHead: loopCommitSchema.nullable(),
    checkpointCommit: loopCommitSchema.nullable(),
    /** Durable product-owned budget, charged before each clean-room E2E workspace is created. */
    e2eAttemptsConsumed: z.number().int().nonnegative().max(CLEAN_ROOM_E2E_MAX_ATTEMPTS),
    sessionAttempts: z.array(loopSessionAttemptSchema).max(CLEAN_ROOM_MAX_DURABLE_SESSION_ATTEMPTS),
    verification: loopVerificationWorkspaceStateSchema.nullable(),
  })
  .strict()
  .superRefine((state, ctx) => validateUniqueSessionIdentities(state.sessionAttempts, ctx));

function validateUniqueSessionIdentities(
  attempts: readonly z.infer<typeof loopSessionAttemptSchema>[],
  ctx: z.RefinementCtx
): void {
  const attemptIds = new Set<string>();
  const conversationIds = new Set<string>();
  for (const [index, attempt] of attempts.entries()) {
    if (attemptIds.has(attempt.attemptId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sessionAttempts', index, 'attemptId'],
        message: 'Session attempt IDs must be append-only and unique',
      });
    }
    if (conversationIds.has(attempt.conversationId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sessionAttempts', index, 'conversationId'],
        message: 'Each fresh Loop session must have a unique conversation ID',
      });
    }
    attemptIds.add(attempt.attemptId);
    conversationIds.add(attempt.conversationId);
  }
}

function upgradeLoopStateV1(
  state: z.infer<typeof loopStateV1Schema>
): z.infer<typeof loopStateV2Schema> {
  return {
    version: '2',
    baseCommit: state.baseCommit,
    expectedFeatureHead: state.expectedFeatureHead,
    checkpointCommit: state.checkpointCommit,
    e2eAttemptsConsumed: 0,
    sessionAttempts: state.sessionAttempts,
    verification: state.verification,
  };
}

/** Strict boundary parser that accepts historical v1 state and returns current v2 authority. */
export const loopStateInputSchema = z.union([
  loopStateV2Schema,
  loopStateV1Schema.transform(upgradeLoopStateV1),
]);

export const loopState = defineVersionedSchema()
  .initial('1', loopStateV1Schema)
  .version('2', loopStateV2Schema, upgradeLoopStateV1)
  .build();
export const loopStateSchema = loopState.schema;

export type LoopMachine = z.infer<typeof loopMachineSchema>;
export type LoopSessionTarget = z.infer<typeof loopSessionTargetSchema>;
export type LoopSessionPurpose = z.infer<typeof loopSessionPurposeSchema>;
export type LoopSessionAttempt = z.infer<typeof loopSessionAttemptSchema>;
export type LoopVerificationWorkspaceState = z.infer<typeof loopVerificationWorkspaceStateSchema>;
export type LoopStateV1 = z.infer<typeof loopStateV1Schema>;
export type LoopStateV2 = typeof loopState.Type;
/** Temporary boundary compatibility while historical v1 rows are upgraded on read. */
export type LoopState = LoopStateV1 | LoopStateV2;
