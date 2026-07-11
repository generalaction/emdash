import z from 'zod';
import { defineVersionedSchema } from '@shared/lib/versioned-schema/versioned-schema';

const boundedIdSchema = z.string().trim().min(1).max(256);
const boundedPathSchema = z.string().trim().min(1).max(4096);
const boundedMessageSchema = z.string().max(4096);
const timestampSchema = z.string().trim().min(1).max(64);

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
    sessionAttempts: z.array(loopSessionAttemptSchema).max(1024),
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

export const loopState = defineVersionedSchema().initial('1', loopStateV1Schema).build();
export const loopStateSchema = loopState.schema;

export type LoopMachine = z.infer<typeof loopMachineSchema>;
export type LoopSessionTarget = z.infer<typeof loopSessionTargetSchema>;
export type LoopSessionPurpose = z.infer<typeof loopSessionPurposeSchema>;
export type LoopSessionAttempt = z.infer<typeof loopSessionAttemptSchema>;
export type LoopVerificationWorkspaceState = z.infer<typeof loopVerificationWorkspaceStateSchema>;
export type LoopState = typeof loopState.Type;
