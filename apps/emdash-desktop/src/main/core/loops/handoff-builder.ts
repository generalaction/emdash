import { Buffer } from 'node:buffer';
import z from 'zod';
import {
  loopArtifactReferenceSchema,
  loopPhaseHandoffSchema,
  type LoopArtifactReference,
  type LoopPhaseHandoff,
} from '@shared/core/loops/loop-phase-state';
import { loopCommitSchema } from '@shared/core/loops/loop-state';

const MAX_PROMPT_GOAL_LENGTH = 16_384;
const MAX_PROMPT_CRITERION_LENGTH = 2_048;
const MAX_PROMPT_CRITERIA = 64;
const MAX_PROMPT_HANDOFFS = 64;

export const MAX_LOOP_PROMPT_DATA_BYTES = 512 * 1024;

const promptGoalSchema = z.string().trim().min(1).max(MAX_PROMPT_GOAL_LENGTH);
const promptAcceptanceCriteriaSchema = z
  .array(z.string().trim().min(1).max(MAX_PROMPT_CRITERION_LENGTH))
  .max(MAX_PROMPT_CRITERIA);

export const loopPromptHandoffSchema = z
  .object({
    source: z.string().trim().min(1).max(256),
    handoff: loopPhaseHandoffSchema,
  })
  .strict();

export const loopPromptContextInputSchema = z
  .object({
    goal: promptGoalSchema,
    acceptanceCriteria: promptAcceptanceCriteriaSchema,
    baseCommit: loopCommitSchema,
    checkpointCommit: loopCommitSchema,
    handoffs: z.array(loopPromptHandoffSchema).max(MAX_PROMPT_HANDOFFS),
  })
  .strict();

export type LoopPhaseHandoffBuildInput = {
  summary: string;
  risks: string[];
  remainingWork: string[];
  artifacts: LoopArtifactReference[];
  createdAt: string;
};

export type LoopPromptHandoff = z.infer<typeof loopPromptHandoffSchema>;
export type LoopPromptContextInput = z.infer<typeof loopPromptContextInputSchema>;

export type LoopPromptHandoffData = {
  source: string;
  summary: string;
  evidence: LoopArtifactReference[];
  risks: string[];
  remainingWork: string[];
  createdAt: string;
};

export type LoopPromptContext = {
  specification: {
    goal: string;
    acceptanceCriteria: string[];
  };
  checkpoint: {
    baseCommit: string;
    checkpointCommit: string;
  };
  handoffs: LoopPromptHandoffData[];
};

function copyArtifact(artifact: LoopArtifactReference): LoopArtifactReference {
  return loopArtifactReferenceSchema.parse({
    artifactId: artifact.artifactId,
    kind: artifact.kind,
    ...(artifact.label !== undefined ? { label: artifact.label } : {}),
    ...(artifact.mimeType !== undefined ? { mimeType: artifact.mimeType } : {}),
    byteLength: artifact.byteLength,
    createdAt: artifact.createdAt,
  });
}

/** Builds only the bounded metadata handoff persisted by the shared Loop contract. */
export function buildLoopPhaseHandoff(input: LoopPhaseHandoffBuildInput): LoopPhaseHandoff {
  return loopPhaseHandoffSchema.parse({
    summary: input.summary,
    risks: [...input.risks],
    remainingWork: [...input.remainingWork],
    artifacts: input.artifacts.map(copyArtifact),
    createdAt: input.createdAt,
  });
}

function copyPromptHandoff(input: LoopPromptHandoff): LoopPromptHandoffData {
  const handoff = buildLoopPhaseHandoff(input.handoff);
  return {
    source: input.source,
    summary: handoff.summary,
    evidence: handoff.artifacts.map(copyArtifact),
    risks: [...handoff.risks],
    remainingWork: [...handoff.remainingWork],
    createdAt: handoff.createdAt,
  };
}

export function buildLoopPromptContext(input: LoopPromptContextInput): LoopPromptContext {
  const parsed = loopPromptContextInputSchema.parse(input);
  return {
    specification: {
      goal: parsed.goal,
      acceptanceCriteria: [...parsed.acceptanceCriteria],
    },
    checkpoint: {
      baseCommit: parsed.baseCommit,
      checkpointCommit: parsed.checkpointCommit,
    },
    handoffs: parsed.handoffs.map(copyPromptHandoff),
  };
}

/**
 * Produces single-line JSON and escapes markup characters so untrusted values cannot create prompt
 * delimiters or Loop sentinel tokens. Callers validate their typed data before using this helper.
 */
export function serializePromptJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    const codePoint = character.codePointAt(0);
    return `\\u${codePoint?.toString(16).padStart(4, '0')}`;
  });
}

export function assertLoopPromptDataSize(...serializedParts: string[]): void {
  const byteLength = serializedParts.reduce(
    (total, serialized) => total + Buffer.byteLength(serialized, 'utf8'),
    0
  );
  if (byteLength > MAX_LOOP_PROMPT_DATA_BYTES) {
    throw new RangeError(
      `Loop prompt data exceeds the ${MAX_LOOP_PROMPT_DATA_BYTES}-byte aggregate limit`
    );
  }
}

export function serializeLoopPromptContext(context: LoopPromptContext): string {
  const serialized = serializePromptJson({
    specification: {
      goal: context.specification.goal,
      acceptanceCriteria: [...context.specification.acceptanceCriteria],
    },
    checkpoint: {
      baseCommit: context.checkpoint.baseCommit,
      checkpointCommit: context.checkpoint.checkpointCommit,
    },
    handoffs: context.handoffs.map((handoff) => ({
      source: handoff.source,
      summary: handoff.summary,
      evidence: handoff.evidence.map(copyArtifact),
      risks: [...handoff.risks],
      remainingWork: [...handoff.remainingWork],
      createdAt: handoff.createdAt,
    })),
  });
  assertLoopPromptDataSize(serialized);
  return serialized;
}
