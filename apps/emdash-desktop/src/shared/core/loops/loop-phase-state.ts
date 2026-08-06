import z from 'zod';
import { defineVersionedSchema } from '@shared/lib/versioned-schema/versioned-schema';
import { loopCommitSchema } from './loop-state';

export const MAX_LOOP_PHASE_RETRY_HANDOFF_BYTES = 512 * 1024;

const canonicalIdSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), 'Expected a canonical identifier');
const canonicalLabelSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), 'Expected canonical text');
const canonicalMimeTypeSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value === value.trim(), 'Expected a canonical MIME type');
const timestampSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isCanonicalTimestamp, 'Expected a canonical ISO timestamp');

export const LOOP_ARTIFACT_KINDS = [
  'test-report',
  'command-log',
  'diff-summary',
  'screenshot',
  'browser-diagnostics',
] as const;

/** Metadata only. Artifact contents remain in bounded app-data storage. */
export const loopArtifactReferenceSchema = z
  .object({
    artifactId: canonicalIdSchema,
    kind: z.enum(LOOP_ARTIFACT_KINDS),
    label: canonicalLabelSchema.optional(),
    mimeType: canonicalMimeTypeSchema.optional(),
    byteLength: z
      .number()
      .int()
      .nonnegative()
      .max(100 * 1024 * 1024),
    createdAt: timestampSchema,
  })
  .strict();

export const loopPhaseHandoffSchema = z
  .object({
    summary: z.string().max(16_384),
    risks: z.array(z.string().max(2048)).max(64),
    remainingWork: z.array(z.string().max(2048)).max(64),
    artifacts: z.array(loopArtifactReferenceSchema).max(64),
    createdAt: timestampSchema,
  })
  .strict();

export const loopPhaseRetryHandoffSchema = z
  .object({
    source: canonicalIdSchema,
    handoff: loopPhaseHandoffSchema,
  })
  .strict();

const loopPhaseRetryHandoffsSchema = z
  .array(loopPhaseRetryHandoffSchema)
  .max(64)
  .superRefine((handoffs, ctx) => {
    if (serializedByteLength(handoffs) > MAX_LOOP_PHASE_RETRY_HANDOFF_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: `Retry handoffs exceed the ${MAX_LOOP_PHASE_RETRY_HANDOFF_BYTES}-byte aggregate limit`,
      });
    }
  });

export const loopStageResultSchema = z
  .object({
    status: z.enum(['passed', 'failed', 'cancelled', 'interrupted']),
    summary: z.string().max(16_384),
    completedAt: timestampSchema,
  })
  .strict();

export const loopPhaseStateV1Schema = z
  .object({
    version: z.literal('1'),
    checkpointCommit: loopCommitSchema.nullable(),
    handoff: loopPhaseHandoffSchema.nullable(),
    result: loopStageResultSchema.nullable(),
  })
  .strict();

export const loopPhaseStateV2Schema = z
  .object({
    version: z.literal('2'),
    checkpointCommit: loopCommitSchema.nullable(),
    handoff: loopPhaseHandoffSchema.nullable(),
    retryHandoffs: loopPhaseRetryHandoffsSchema,
    result: loopStageResultSchema.nullable(),
  })
  .strict();

function upgradeLoopPhaseStateV1(
  state: z.infer<typeof loopPhaseStateV1Schema>
): z.infer<typeof loopPhaseStateV2Schema> {
  return {
    version: '2',
    checkpointCommit: state.checkpointCommit,
    handoff: state.handoff,
    retryHandoffs: [],
    result: state.result,
  };
}

/** Strict persisted-input parser for boundaries that must accept and upgrade v1 at runtime. */
export const loopPhaseStateInputSchema = z.union([
  loopPhaseStateV2Schema,
  loopPhaseStateV1Schema.transform(upgradeLoopPhaseStateV1),
]);

export const loopPhaseState = defineVersionedSchema()
  .initial('1', loopPhaseStateV1Schema)
  .version('2', loopPhaseStateV2Schema, upgradeLoopPhaseStateV1)
  .build();
export const loopPhaseStateSchema = loopPhaseState.schema;

export type LoopArtifactReference = z.infer<typeof loopArtifactReferenceSchema>;
export type LoopPhaseHandoff = z.infer<typeof loopPhaseHandoffSchema>;
export type LoopPhaseRetryHandoff = z.infer<typeof loopPhaseRetryHandoffSchema>;
export type LoopStageResult = z.infer<typeof loopStageResultSchema>;
export type LoopPhaseState = typeof loopPhaseState.Type;

function isCanonicalTimestamp(value: string): boolean {
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

function serializedByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
