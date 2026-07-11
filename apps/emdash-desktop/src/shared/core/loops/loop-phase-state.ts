import z from 'zod';
import { defineVersionedSchema } from '@shared/lib/versioned-schema/versioned-schema';
import { loopCommitSchema } from './loop-state';

const timestampSchema = z.string().trim().min(1).max(64);

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
    artifactId: z.string().trim().min(1).max(256),
    kind: z.enum(LOOP_ARTIFACT_KINDS),
    label: z.string().trim().min(1).max(256).optional(),
    mimeType: z.string().trim().min(1).max(128).optional(),
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

export const loopPhaseState = defineVersionedSchema().initial('1', loopPhaseStateV1Schema).build();
export const loopPhaseStateSchema = loopPhaseState.schema;

export type LoopArtifactReference = z.infer<typeof loopArtifactReferenceSchema>;
export type LoopPhaseHandoff = z.infer<typeof loopPhaseHandoffSchema>;
export type LoopStageResult = z.infer<typeof loopStageResultSchema>;
export type LoopPhaseState = typeof loopPhaseState.Type;
