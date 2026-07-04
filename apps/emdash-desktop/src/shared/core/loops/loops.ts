import z from 'zod';

export const LOOP_STATUSES = ['draft', 'running', 'paused', 'failed', 'completed'] as const;
export const PHASE_STATUSES = [
  'pending',
  'running',
  'verifying',
  'reviewing',
  'passed',
  'failed',
] as const;
export const VERIFIER_IDS = ['gh', 'vercel', 'convex', 'agent-browser'] as const;

export const loopStatusSchema = z.enum(LOOP_STATUSES);
export const phaseStatusSchema = z.enum(PHASE_STATUSES);
export const verifierIdSchema = z.enum(VERIFIER_IDS);

export type LoopStatus = z.infer<typeof loopStatusSchema>;
export type PhaseStatus = z.infer<typeof phaseStatusSchema>;
export type VerifierId = z.infer<typeof verifierIdSchema>;

export const loopConfigV1Schema = z.object({
  version: z.literal('1'),
  verifiers: z.array(verifierIdSchema),
  reviewEnabled: z.boolean(),
  validationCommands: z.array(z.string()),
  planSource: z.string(),
});

export type LoopConfig = z.infer<typeof loopConfigV1Schema>;

export const loopPhaseCriterionSchema = z.object({
  description: z.string(),
  verifier: verifierIdSchema,
  status: phaseStatusSchema,
  evidence: z.string().optional(),
});

export type LoopPhaseCriterion = z.infer<typeof loopPhaseCriterionSchema>;

export const loopPhaseCriteriaV1Schema = z.object({
  version: z.literal('1'),
  criteria: z.array(loopPhaseCriterionSchema),
});

export type LoopPhaseCriteria = z.infer<typeof loopPhaseCriteriaV1Schema>;

const LOOP_STATUS_SET = new Set<string>(LOOP_STATUSES);
const PHASE_STATUS_SET = new Set<string>(PHASE_STATUSES);
const VERIFIER_ID_SET = new Set<string>(VERIFIER_IDS);

export function isLoopStatus(value: unknown): value is LoopStatus {
  return typeof value === 'string' && LOOP_STATUS_SET.has(value);
}

export function isPhaseStatus(value: unknown): value is PhaseStatus {
  return typeof value === 'string' && PHASE_STATUS_SET.has(value);
}

export function isVerifierId(value: unknown): value is VerifierId {
  return typeof value === 'string' && VERIFIER_ID_SET.has(value);
}

export function isLoopConfig(value: unknown): value is LoopConfig {
  return loopConfigV1Schema.safeParse(value).success;
}

export function isLoopPhaseCriterion(value: unknown): value is LoopPhaseCriterion {
  return loopPhaseCriterionSchema.safeParse(value).success;
}
