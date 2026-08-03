import z from 'zod';
import { err, ok, type Result } from '@main/lib/result';
import { loopPhaseStateInputSchema } from '@shared/core/loops/loop-phase-state';
import {
  CLEAN_ROOM_E2E_MAX_ATTEMPTS,
  CLEAN_ROOM_E2E_MAX_SESSION_RECORDS_PER_ATTEMPT,
  CLEAN_ROOM_MAX_DURABLE_SESSION_ATTEMPTS,
  loopSessionTargetSchema,
  loopStateInputSchema,
  loopStateV2Schema,
  type LoopSessionAttempt,
  type LoopSessionTarget,
} from '@shared/core/loops/loop-state';
import {
  loopPhaseCriteriaV1Schema,
  loopPhaseCriterionSchema,
  loopProviderSchema,
  loopTerminalGatesSchema,
  newLoopConfigV2Schema,
  type Loop,
  type LoopPhase,
  type LoopPhaseCriterion,
  type LoopTerminalGates,
} from '@shared/core/loops/loops';
import type { CleanRoomProject } from '../clean-room/clean-room-workspace-service';
import {
  loopPromptContextInputSchema,
  type LoopPromptContextInput,
  type LoopPromptHandoff,
} from '../handoff-builder';
import {
  copyCriterion,
  copyPromptHandoff,
  hasCanonicalPersistedLoopState,
  hasCanonicalPhaseCriteria,
  hasCanonicalPhaseState,
  isCanonicalAbsolutePath,
  isCanonicalTarget,
  redactPersistedText,
  safeCopyPromptHandoffs,
  sameCanonicalJsonShape,
  serializedBytes,
  stabilizePlainSuccess,
  tryCopyPromptHandoff,
  validAbortSignal,
  validId,
  validTimestamp,
} from './clean-room-e2e-boundary';
import type { RunCleanRoomE2EGateInput } from './clean-room-e2e-gate';
import { copyE2EDurableProgress, type E2EDurableProgress } from './clean-room-e2e-progress';
import { copyAttempt } from './clean-room-e2e-session-ledger';

const MAX_ID_LENGTH = 256;
const MAX_MODEL_LENGTH = 256;
const MAX_SUMMARY_LENGTH = 16_384;
const MAX_SESSION_ATTEMPTS = CLEAN_ROOM_MAX_DURABLE_SESSION_ATTEMPTS;
const MAX_VALIDATION_COMMANDS = 64;
const MAX_VALIDATION_COMMAND_LENGTH = 4_096;
const MAX_CRITERION_DESCRIPTION_LENGTH = 2_048;
const MAX_CRITERION_EVIDENCE_LENGTH = 16_384;
const MAX_CRITERIA_BYTES = 256 * 1024;

export type NormalizedInput = RunCleanRoomE2EGateInput & {
  featureTarget: LoopSessionTarget;
  validationCommands: string[];
  criteria: LoopPhaseCriterion[];
  previousSessionAttempts: LoopSessionAttempt[];
  e2eAttemptsConsumed: number;
  progress: { current: E2EDurableProgress };
};

export { CLEAN_ROOM_E2E_MAX_ATTEMPTS, CLEAN_ROOM_MAX_DURABLE_SESSION_ATTEMPTS };

export const validationCommandsSchema = z
  .array(z.string().trim().min(1).max(MAX_VALIDATION_COMMAND_LENGTH))
  .min(1)
  .max(MAX_VALIDATION_COMMANDS);
const e2eCriterionSchema = loopPhaseCriterionSchema
  .extend({
    description: z.string().trim().min(1).max(MAX_CRITERION_DESCRIPTION_LENGTH),
    evidence: z.string().max(MAX_CRITERION_EVIDENCE_LENGTH).optional(),
  })
  .strict();
export const e2eCriteriaSchema = z
  .array(e2eCriterionSchema)
  .min(1)
  .max(64)
  .refine(
    (criteria) => serializedBytes(criteria) <= MAX_CRITERIA_BYTES,
    'E2E criteria exceed the aggregate byte limit'
  )
  .refine(
    (criteria) => criteria.some((criterion) => criterion.verifier === 'agent-browser'),
    'E2E criteria must include native browser verification'
  );
const e2eLoopConfigSchema = newLoopConfigV2Schema.strict();
const e2ePhaseCriteriaSchema = loopPhaseCriteriaV1Schema.strict();

export function safeNormalizeInput(
  input: RunCleanRoomE2EGateInput
): Result<NormalizedInput, { type: string; message: string }> {
  try {
    return normalizeInput(snapshotRunInput(input));
  } catch {
    return err({
      type: 'invalid-input',
      message: 'Loop E2E input could not be read safely.',
    });
  }
}

export function snapshotRunInput(input: RunCleanRoomE2EGateInput): RunCleanRoomE2EGateInput {
  const loop = stabilizePlainSuccess<Loop>(input.loop);
  const phase = stabilizePlainSuccess<LoopPhase>(input.phase);
  const task = stabilizePlainSuccess<{ id: string; name: string }>(input.task);
  const featureTarget = stabilizePlainSuccess<LoopSessionTarget>(input.featureTarget);
  const terminalGates = stabilizePlainSuccess<LoopTerminalGates>(input.terminalGates);
  const promptContext = stabilizePlainSuccess<LoopPromptContextInput>({
    goal: input.goal,
    acceptanceCriteria: input.acceptanceCriteria,
    baseCommit: input.baseCommit,
    checkpointCommit: input.checkpointCommit,
    handoffs: input.handoffs,
  });
  const intermediateFailures = stabilizePlainSuccess<LoopPromptHandoff[]>(
    input.intermediateFailures
  );
  const rawProject = input.project;
  const project = snapshotProject(rawProject);
  const provider = input.provider;
  const model = input.model;
  const signal = input.signal;
  const deadlineAt = input.deadlineAt;
  if (
    !loop ||
    !phase ||
    !task ||
    !featureTarget ||
    !terminalGates ||
    !promptContext ||
    !intermediateFailures
  ) {
    throw new TypeError('Invalid clean-room E2E boundary snapshot.');
  }
  return {
    ...promptContext,
    loop,
    phase,
    task,
    project,
    featureTarget,
    provider,
    model,
    terminalGates,
    intermediateFailures,
    ...(signal !== undefined ? { signal } : {}),
    ...(deadlineAt !== undefined ? { deadlineAt } : {}),
  };
}

export function normalizeInput(
  input: RunCleanRoomE2EGateInput
): Result<NormalizedInput, { type: string; message: string }> {
  const promptContext = loopPromptContextInputSchema.safeParse({
    goal: input.goal,
    acceptanceCriteria: input.acceptanceCriteria,
    baseCommit: input.baseCommit,
    checkpointCommit: input.checkpointCommit,
    handoffs: input.handoffs,
  });
  if (
    !promptContext.success ||
    !Array.isArray(input.handoffs) ||
    input.handoffs.some((handoff) => !tryCopyPromptHandoff(handoff))
  ) {
    return err({ type: 'invalid-input', message: 'Invalid bounded E2E prompt context.' });
  }
  const target = loopSessionTargetSchema.safeParse(input.featureTarget);
  if (!target.success || !isCanonicalTarget(input.featureTarget, target.data)) {
    return err({ type: 'invalid-input', message: 'Invalid feature execution target.' });
  }
  const provider = loopProviderSchema.safeParse(input.provider);
  if (!provider.success) {
    return err({ type: 'invalid-input', message: 'Invalid E2E provider.' });
  }
  const terminalGates = loopTerminalGatesSchema.safeParse(input.terminalGates);
  if (!terminalGates.success) {
    return err({ type: 'invalid-input', message: 'Invalid terminal-gate authority.' });
  }
  if (
    typeof input.model !== 'string' ||
    input.model !== input.model.trim() ||
    input.model.trim().length === 0 ||
    input.model.length > MAX_MODEL_LENGTH
  ) {
    return err({ type: 'invalid-input', message: 'Invalid E2E model.' });
  }
  if (
    !input.loop ||
    typeof input.loop !== 'object' ||
    !input.phase ||
    typeof input.phase !== 'object' ||
    !input.task ||
    typeof input.task !== 'object' ||
    !input.project ||
    typeof input.project !== 'object'
  ) {
    return err({ type: 'invalid-input', message: 'Invalid Loop E2E authority.' });
  }
  const config = e2eLoopConfigSchema.safeParse(input.loop.config);
  const state = loopStateInputSchema.safeParse(input.loop.state);
  const phaseCriteria = e2ePhaseCriteriaSchema.safeParse(input.phase.criteria);
  const criteria = e2eCriteriaSchema.safeParse(
    input.phase.criteria && typeof input.phase.criteria === 'object'
      ? (input.phase.criteria as { criteria?: unknown }).criteria
      : undefined
  );
  const phaseState =
    input.phase.state === undefined || input.phase.state === null
      ? { success: true as const, data: null }
      : loopPhaseStateInputSchema.safeParse(input.phase.state);
  if (
    !config.success ||
    !state.success ||
    !phaseCriteria.success ||
    !criteria.success ||
    !phaseState.success ||
    !sameCanonicalJsonShape(input.loop.config, config.success ? config.data : undefined) ||
    !hasCanonicalPhaseCriteria(input.phase.criteria, criteria.success ? criteria.data : []) ||
    !hasCanonicalPersistedLoopState(input.loop.state) ||
    !hasCanonicalPhaseState(input.phase.state) ||
    !validCoreAuthority(input)
  ) {
    return err({
      type: 'invalid-input',
      message: 'Loop E2E requires current persisted config, state, and phase criteria authority.',
    });
  }
  const validationCommands = validationCommandsSchema.safeParse(config.data.validationCommands);
  if (
    !validationCommands.success ||
    !criteria.success ||
    !sameCanonicalJsonShape(config.data.validationCommands, validationCommands.data)
  ) {
    return err({
      type: 'invalid-input',
      message: 'Loop E2E validation commands and criteria are invalid or unbounded.',
    });
  }
  const normalizedModel = input.model;
  if (
    input.provider !== 'codex' ||
    config.data.provider !== input.provider ||
    config.data.model !== normalizedModel ||
    config.data.browserPreview.enabled !== true ||
    config.data.reviewEnabled !== config.data.terminalGates.review ||
    config.data.terminalGates.review !== terminalGates.data.review ||
    config.data.terminalGates.e2e !== terminalGates.data.e2e ||
    state.data.baseCommit !== input.baseCommit ||
    state.data.expectedFeatureHead !== input.checkpointCommit ||
    state.data.checkpointCommit !== input.checkpointCommit
  ) {
    return err({
      type: 'invalid-input',
      message: 'Caller E2E authority does not match the persisted Loop checkpoint contract.',
    });
  }
  if (input.phase.kind !== 'e2e' || input.phase.loopId !== input.loop.id) {
    return err({
      type: 'invalid-input',
      message: 'The selected phase is not this Loop E2E phase.',
    });
  }
  if (input.task.id !== input.loop.taskId || input.project.projectId !== input.loop.projectId) {
    return err({
      type: 'invalid-input',
      message: 'Loop, task, and project identities do not match.',
    });
  }
  const copiedIntermediateFailures = safeCopyPromptHandoffs(input.intermediateFailures);
  const persistedRetryHandoffs = phaseState.data?.retryHandoffs ?? [];
  if (
    !Array.isArray(input.intermediateFailures) ||
    input.intermediateFailures.length > 64 ||
    copiedIntermediateFailures.length !== input.intermediateFailures.length ||
    JSON.stringify(copiedIntermediateFailures) !== JSON.stringify(persistedRetryHandoffs)
  ) {
    return err({ type: 'invalid-input', message: 'Invalid intermediate E2E failure handoff.' });
  }
  if (
    input.deadlineAt !== undefined &&
    (!Number.isFinite(input.deadlineAt) || input.deadlineAt < 0)
  ) {
    return err({ type: 'invalid-input', message: 'Invalid E2E deadline.' });
  }
  if (input.signal !== undefined && !validAbortSignal(input.signal)) {
    return err({ type: 'invalid-input', message: 'Invalid E2E cancellation signal.' });
  }
  const consumedAttempts = countDurableE2EAttempts(
    state.data.sessionAttempts,
    input.phase.id,
    state.data.e2eAttemptsConsumed
  );
  const remainingAttempts = Math.max(0, CLEAN_ROOM_E2E_MAX_ATTEMPTS - consumedAttempts);
  if (
    state.data.sessionAttempts.length +
      remainingAttempts * CLEAN_ROOM_E2E_MAX_SESSION_RECORDS_PER_ATTEMPT >
    MAX_SESSION_ATTEMPTS
  ) {
    return err({
      type: 'invalid-input',
      message: 'The durable session ledger lacks capacity for the remaining E2E attempt cap.',
    });
  }
  const project = input.project;
  const loop: Loop = {
    id: input.loop.id,
    projectId: input.loop.projectId,
    taskId: input.loop.taskId,
    name: input.loop.name,
    slug: input.loop.slug,
    status: input.loop.status,
    currentPhaseIndex: input.loop.currentPhaseIndex,
    config: { ...config.data, validationCommands: [...validationCommands.data] },
    ...(input.loop.isPrimary !== undefined ? { isPrimary: input.loop.isPrimary } : {}),
    state: state.data,
    createdAt: input.loop.createdAt,
    updatedAt: input.loop.updatedAt,
  };
  const phase: LoopPhase = {
    id: input.phase.id,
    loopId: input.phase.loopId,
    idx: input.phase.idx,
    name: input.phase.name,
    goal: input.phase.goal,
    status: input.phase.status,
    attempts: input.phase.attempts,
    conversationId: input.phase.conversationId,
    criteria: { version: '1', criteria: criteria.data.map(copyCriterion) },
    lastError: input.phase.lastError,
    kind: input.phase.kind,
    state: phaseState.data,
    createdAt: input.phase.createdAt,
    updatedAt: input.phase.updatedAt,
  };
  return ok({
    goal: promptContext.data.goal,
    acceptanceCriteria: [...promptContext.data.acceptanceCriteria],
    baseCommit: promptContext.data.baseCommit,
    checkpointCommit: promptContext.data.checkpointCommit,
    handoffs: safeCopyPromptHandoffs(promptContext.data.handoffs),
    loop,
    phase,
    task: { id: input.task.id, name: input.task.name },
    project,
    featureTarget: target.data,
    provider: provider.data,
    model: normalizedModel,
    terminalGates: { ...terminalGates.data },
    intermediateFailures: persistedRetryHandoffs.map(copyPromptHandoff),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
    validationCommands: [...validationCommands.data],
    criteria: criteria.data.map(copyCriterion),
    previousSessionAttempts: state.data.sessionAttempts.map(copyAttempt),
    e2eAttemptsConsumed: consumedAttempts,
    progress: {
      current: copyE2EDurableProgress({
        loopState: state.data,
        phaseState: phaseState.data,
      }),
    },
  });
}

export function validCoreAuthority(input: RunCleanRoomE2EGateInput): boolean {
  try {
    return (
      validId(input.loop.id) &&
      validId(input.loop.projectId) &&
      validId(input.loop.taskId) &&
      validId(input.phase.id) &&
      validId(input.phase.loopId) &&
      validId(input.task.id) &&
      validId(input.project.projectId) &&
      input.loop.id === input.phase.loopId &&
      input.loop.taskId === input.task.id &&
      input.loop.projectId === input.project.projectId &&
      typeof input.task.name === 'string' &&
      input.task.name === input.task.name.trim() &&
      input.task.name.length > 0 &&
      input.task.name.length <= 1_024 &&
      typeof input.loop.name === 'string' &&
      input.loop.name.length <= MAX_SUMMARY_LENGTH &&
      typeof input.loop.slug === 'string' &&
      input.loop.slug.length > 0 &&
      input.loop.slug.length <= MAX_ID_LENGTH &&
      Number.isInteger(input.loop.currentPhaseIndex) &&
      input.loop.currentPhaseIndex >= 0 &&
      Number.isInteger(input.phase.idx) &&
      input.phase.idx >= 0 &&
      Number.isInteger(input.phase.attempts) &&
      input.phase.attempts >= 0 &&
      typeof input.phase.name === 'string' &&
      input.phase.name.length <= MAX_SUMMARY_LENGTH &&
      typeof input.phase.goal === 'string' &&
      input.phase.goal.length <= MAX_SUMMARY_LENGTH &&
      (input.phase.conversationId === null || validId(input.phase.conversationId)) &&
      (input.phase.lastError === null ||
        (typeof input.phase.lastError === 'string' &&
          input.phase.lastError.length <= MAX_SUMMARY_LENGTH &&
          redactPersistedText(input.phase.lastError) === input.phase.lastError)) &&
      validEntityTimestamp(input.loop.createdAt) &&
      validEntityTimestamp(input.loop.updatedAt) &&
      validEntityTimestamp(input.phase.createdAt) &&
      validEntityTimestamp(input.phase.updatedAt) &&
      typeof input.project.repoPath === 'string' &&
      isCanonicalAbsolutePath(input.project.repoPath)
    );
  } catch {
    return false;
  }
}

function validEntityTimestamp(value: unknown): value is string {
  if (validTimestamp(value)) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value)) {
    return false;
  }
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().replace('T', ' ').slice(0, 19) === value
  );
}

export function snapshotProject(project: CleanRoomProject): CleanRoomProject {
  const projectId = project.projectId;
  const repoPath = project.repoPath;
  const ctx = project.ctx;
  const defaultWorkspaceMachine = project.defaultWorkspaceMachine;
  const defaultWorkspaceType = project.defaultWorkspaceType;
  const worktreeService = project.worktreeService;
  const settings = project.settings;
  const gitRepository = project.gitRepository;
  const gitRepositoryFetchService = project.gitRepositoryFetchService;
  const machine =
    stabilizePlainSuccess<CleanRoomProject['defaultWorkspaceMachine']>(defaultWorkspaceMachine);
  if (
    !machine ||
    !ctx ||
    !worktreeService ||
    !settings ||
    !gitRepository ||
    !gitRepositoryFetchService
  ) {
    throw new TypeError('Invalid clean-room project service authority.');
  }
  return {
    projectId,
    repoPath,
    ctx,
    defaultWorkspaceMachine: machine,
    defaultWorkspaceType,
    worktreeService,
    settings,
    gitRepository,
    gitRepositoryFetchService,
  };
}

export function countDurableE2EAttempts(
  attempts: readonly LoopSessionAttempt[],
  phaseId: string,
  persistedCount = 0
): number {
  return Math.max(persistedCount, durableE2EVerificationRunIds(attempts, phaseId).length);
}

export function durableE2EVerificationRunIds(
  attempts: readonly LoopSessionAttempt[],
  phaseId: string
): string[] {
  const runs = new Set<string>();
  for (const attempt of attempts) {
    if (attempt.purpose !== 'e2e' || attempt.phaseId !== phaseId) continue;
    runs.add(attempt.verificationRunId ?? `attempt:${attempt.attemptId}`);
  }
  return [...runs];
}

export function terminalPrecondition(
  input: NormalizedInput
): { type: string; message: string } | undefined {
  const state = loopStateV2Schema.parse(input.loop.state);
  const phaseState =
    input.phase.state === null || input.phase.state === undefined
      ? null
      : loopPhaseStateInputSchema.parse(input.phase.state);
  if (
    input.loop.status !== 'running' ||
    input.phase.status !== 'reviewing' ||
    input.loop.currentPhaseIndex !== input.phase.idx
  ) {
    return {
      type: 'phase-authority-invalid',
      message: 'The E2E phase is not the current eligible running phase.',
    };
  }
  if (
    state.verification !== null ||
    state.sessionAttempts.some(
      (attempt) => attempt.status === 'starting' || attempt.status === 'running'
    )
  ) {
    return {
      type: 'recovery-required',
      message: 'Interrupted verification authority must be quiesced and cleared before a new run.',
    };
  }
  if (phaseState?.result) {
    return {
      type: 'phase-already-terminal',
      message: 'A terminal E2E phase cannot be executed again.',
    };
  }
  if (
    phaseState !== null &&
    phaseState.checkpointCommit !== null &&
    phaseState.checkpointCommit !== input.checkpointCommit
  ) {
    return {
      type: 'phase-authority-invalid',
      message: 'The E2E phase checkpoint does not match current Loop authority.',
    };
  }
  if (!input.terminalGates.e2e) {
    return { type: 'e2e-disabled', message: 'The E2E terminal gate is disabled.' };
  }
  return undefined;
}
