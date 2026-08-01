import z from 'zod';
import type { LoopPhaseState } from './loop-phase-state';
import type { LoopState } from './loop-state';

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
export const LOOP_PROVIDER_IDS = ['claude', 'codex'] as const;
export const LOOP_PHASE_KINDS = ['work', 'review', 'e2e'] as const;

export const loopStatusSchema = z.enum(LOOP_STATUSES);
export const phaseStatusSchema = z.enum(PHASE_STATUSES);
export const verifierIdSchema = z.enum(VERIFIER_IDS);
export const loopProviderSchema = z.enum(LOOP_PROVIDER_IDS);
export const loopPhaseKindSchema = z.enum(LOOP_PHASE_KINDS);

export type LoopStatus = z.infer<typeof loopStatusSchema>;
export type PhaseStatus = z.infer<typeof phaseStatusSchema>;
export type VerifierId = z.infer<typeof verifierIdSchema>;
export type LoopProviderId = z.infer<typeof loopProviderSchema>;
export type LoopPhaseKind = z.infer<typeof loopPhaseKindSchema>;

/** Provider used by newly authored v2 Loops. Historical v1 rows had a Claude default. */
export const DEFAULT_LOOP_PROVIDER = 'codex' as const satisfies LoopProviderId;
export const LEGACY_DEFAULT_LOOP_PROVIDER = 'claude' as const satisfies LoopProviderId;

export const loopTerminalGatesSchema = z
  .object({
    review: z.boolean(),
    e2e: z.boolean(),
  })
  .strict();

export const loopBrowserPreviewConfigSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export type LoopTerminalGates = z.infer<typeof loopTerminalGatesSchema>;
export type LoopBrowserPreviewConfig = z.infer<typeof loopBrowserPreviewConfigSchema>;

export const loopConfigV1Schema = z.object({
  version: z.literal('1'),
  provider: loopProviderSchema.optional(),
  verifiers: z.array(verifierIdSchema),
  reviewEnabled: z.boolean(),
  validationCommands: z.array(z.string()),
  planSource: z.string(),
  agentBrowser: z
    .object({
      targetUrl: z.string().optional(),
      cdpPort: z.number().int().positive().optional(),
    })
    .optional(),
});

export const loopConfigV2Schema = z.object({
  version: z.literal('2'),
  provider: loopProviderSchema,
  /** Null preserves the provider-default model behavior of migrated v1 rows. */
  model: z.string().trim().min(1).max(256).nullable(),
  validationCommands: z.array(z.string()),
  planSource: z.string(),
  terminalGates: loopTerminalGatesSchema,
  browserPreview: loopBrowserPreviewConfigSchema,
  /** @deprecated Kept until all v1 readers move to terminalGates.review. */
  reviewEnabled: z.boolean(),
  /** @deprecated Kept until native verifier registry integration removes v1 verifier IDs. */
  verifiers: z.array(verifierIdSchema),
  /** @deprecated Native browser verification does not use target URLs or CDP ports. */
  agentBrowser: z
    .object({
      targetUrl: z.string().optional(),
      cdpPort: z.number().int().positive().optional(),
    })
    .optional(),
});

/** New v2 Loops must persist a single Codex provider/model pair. */
export const newLoopConfigV2Schema = loopConfigV2Schema.extend({
  provider: z.literal('codex'),
  model: z.string().trim().min(1).max(256),
});

export type LoopConfigV1 = z.infer<typeof loopConfigV1Schema>;
export type LoopConfigV2 = z.infer<typeof loopConfigV2Schema>;
export type NewLoopConfigV2 = z.infer<typeof newLoopConfigV2Schema>;

/**
 * Temporary write compatibility for the v1 engine. Versioned reads always upgrade to v2, while
 * unchanged v1 writers remain type-safe until the serial integration lane moves them to v2.
 */
export type LoopConfig = LoopConfigV1 | LoopConfigV2;

export type CreateLoopConfigV2Input = {
  model: string;
  validationCommands: string[];
  planSource: string;
  terminalGates: LoopTerminalGates;
  browserPreview: LoopBrowserPreviewConfig;
  verifiers?: VerifierId[];
  agentBrowser?: LoopConfigV1['agentBrowser'];
};

export function createLoopConfigV2(input: CreateLoopConfigV2Input): NewLoopConfigV2 {
  return newLoopConfigV2Schema.parse({
    version: '2',
    provider: DEFAULT_LOOP_PROVIDER,
    model: input.model,
    validationCommands: input.validationCommands,
    planSource: input.planSource,
    terminalGates: input.terminalGates,
    browserPreview: input.browserPreview,
    reviewEnabled: input.terminalGates.review,
    verifiers: input.verifiers ?? [],
    ...(input.agentBrowser ? { agentBrowser: input.agentBrowser } : {}),
  });
}

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

export function resolveLoopProvider(config: LoopConfig | null | undefined): LoopProviderId {
  if (!config) return LEGACY_DEFAULT_LOOP_PROVIDER;
  return config.provider ?? LEGACY_DEFAULT_LOOP_PROVIDER;
}

export function resolveLoopModel(config: LoopConfig | null | undefined): string | null {
  return config?.version === '2' ? config.model : null;
}

export function isLoopConfig(value: unknown): value is LoopConfig {
  return loopConfigV1Schema.safeParse(value).success || loopConfigV2Schema.safeParse(value).success;
}

export function isLoopPhaseCriterion(value: unknown): value is LoopPhaseCriterion {
  return loopPhaseCriterionSchema.safeParse(value).success;
}

export function orderedLoopPhaseKinds(
  workPhaseCount: number,
  terminalGates: LoopTerminalGates
): LoopPhaseKind[] {
  if (!Number.isInteger(workPhaseCount) || workPhaseCount < 0) {
    throw new RangeError('workPhaseCount must be a non-negative integer');
  }

  const kinds: LoopPhaseKind[] = Array.from({ length: workPhaseCount }, () => 'work');
  if (terminalGates.review) kinds.push('review');
  if (terminalGates.e2e) kinds.push('e2e');
  return kinds;
}

export const loopPrimaryConflictSchema = z
  .object({
    kind: z.literal('primary-loop-exists'),
    taskId: z.string().min(1),
    existingLoopId: z.string().min(1),
  })
  .strict();

export type LoopPrimaryConflict = z.infer<typeof loopPrimaryConflictSchema>;

export type Loop = {
  id: string;
  projectId: string;
  taskId: string;
  name: string;
  slug: string;
  status: LoopStatus;
  currentPhaseIndex: number;
  config: LoopConfig | null;
  /** Added in v2; optional until the serial engine integration maps the new DB column. */
  isPrimary?: boolean;
  /** Added in v2; optional until the serial engine integration maps the new DB column. */
  state?: LoopState | null;
  createdAt: string;
  updatedAt: string;
};

export type LoopPhase = {
  id: string;
  loopId: string;
  idx: number;
  name: string;
  goal: string;
  status: PhaseStatus;
  attempts: number;
  conversationId: string | null;
  criteria: LoopPhaseCriteria | null;
  lastError: string | null;
  /** Added in v2; legacy rows and v1 object literals are work phases. */
  kind?: LoopPhaseKind;
  /** Added in v2; optional until the serial engine integration maps the new DB column. */
  state?: LoopPhaseState | null;
  createdAt: string;
  updatedAt: string;
};

export type LoopWithPhases = Loop & {
  phases: LoopPhase[];
};

export type CreateLoopCriterionParams = {
  description: string;
  verifier: VerifierId;
};

export type CreateLoopPhaseParams = {
  name: string;
  goal: string;
  criteria: CreateLoopCriterionParams[];
  kind?: LoopPhaseKind;
};

export type CreateLoopParams = {
  id?: string;
  projectId: string;
  taskId: string;
  name: string;
  provider?: LoopProviderId;
  planSource: string;
  validationCommands: string[];
  verifiers: VerifierId[];
  reviewEnabled: boolean;
  phases: CreateLoopPhaseParams[];
  agentBrowser?: {
    targetUrl?: string;
    cdpPort?: number;
  };
};

export type LoopVerifierAvailability = {
  id: VerifierId;
  label: string;
  available: boolean;
  reason?: string;
};
