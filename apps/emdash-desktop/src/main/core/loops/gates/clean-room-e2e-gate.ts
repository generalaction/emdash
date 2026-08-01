import { Buffer } from 'node:buffer';
import z from 'zod';
import { getTaskEnvVars } from '@main/core/workspaces/workspace-env';
import { err, ok, type Result } from '@main/lib/result';
import {
  loopArtifactReferenceSchema,
  loopStageResultSchema,
  type LoopArtifactReference,
  type LoopPhaseHandoff,
  type LoopStageResult,
} from '@shared/core/loops/loop-phase-state';
import {
  loopCommitSchema,
  loopSessionAttemptSchema,
  loopSessionTargetSchema,
  type LoopSessionAttempt,
  type LoopSessionTarget,
  type LoopVerificationWorkspaceState,
} from '@shared/core/loops/loop-state';
import {
  loopProviderSchema,
  type Loop,
  type LoopPhase,
  type LoopPhaseCriterion,
  type LoopProviderId,
  type LoopTerminalGates,
} from '@shared/core/loops/loops';
import type {
  CleanRoomProject,
  CleanRoomWorkspace,
} from '../clean-room/clean-room-workspace-service';
import type { CleanRoomPendingCleanup } from '../clean-room/cleanup-journal';
import { buildE2EPrompt, parseE2ESentinel } from '../e2e-prompt';
import {
  loopPromptHandoffSchema,
  type LoopPromptContextInput,
  type LoopPromptHandoff,
} from '../handoff-builder';
import type { LoopExecutionTarget } from '../runtime/loop-execution-target';
import {
  boundedSummary,
  copyCriterion,
  copyEnvironment,
  copyPromptHandoff,
  copyTarget,
  hasCanonicalAttemptFields,
  hasCanonicalAttemptTarget,
  monotonicTimestamp,
  redactPersistedText,
  safeCopyPromptHandoffs,
  sameCriteria,
  sameEnvironment,
  sameExecutionTargetIdentity,
  sameStringArray,
  sameTarget,
  stabilizePlainSuccess,
  tryCopyPromptHandoff,
  validCommit,
  validId,
} from './clean-room-e2e-boundary';
import {
  clonePendingWorkspace,
  controlFailure,
  errorMessage,
  normalizeDependencyResult,
  pendingWorkspaceAuthority,
  pendingWorkspaceFromCleanup,
  raceWithControl,
  remainingTimeout,
  safeCreatePendingCleanup,
  safeDate,
  safeNow,
  safePendingCleanup,
  stabilizeDurableProgress,
  stabilizeExecutionBinding,
  validatePrerequisites,
  verificationProgress,
  type ControlledDependencyOutcome,
  type SuccessStabilizer,
} from './clean-room-e2e-gate-lifecycle';
import {
  CLEAN_ROOM_E2E_MAX_ATTEMPTS,
  durableE2EVerificationRunIds,
  e2eCriteriaSchema,
  safeNormalizeInput,
  terminalPrecondition,
  validationCommandsSchema,
  type NormalizedInput,
} from './clean-room-e2e-input';
import {
  bootstrapOuterSession,
  type E2ECancellationRegistry,
  type OuterSessionBootstrapOperations,
} from './clean-room-e2e-outer-session';
import {
  copyE2EDurableProgress,
  reduceE2EProgress,
  sameE2EDurableProgress,
  type E2EDurableProgress,
  type E2EProgressPort,
  type E2EProgressTransition,
} from './clean-room-e2e-progress';
import {
  copyAttempt,
  collectNestedAttemptSettlement,
  freshAttemptIdentity,
  hasCompleteTerminalNestedAuthority,
  markNestedAttemptInterrupted,
  markOuterAttempt,
  tryMakeOuterAttempt,
  validateBeginning,
  validateCleanRoom,
  validateCorrectionInspection,
  validateFeature,
  validateInspection,
  validatePassInspection,
  validatePostChecks,
} from './clean-room-e2e-session-ledger';

const MAX_ATTEMPTS = 64;
const MAX_ID_LENGTH = 256;
const MAX_MODEL_LENGTH = 256;
const MAX_SUMMARY_LENGTH = 16_384;
const MAX_TASK_ENVIRONMENT_BYTES = 64 * 1024;
const MAX_TASK_ENVIRONMENT_VALUE_LENGTH = 4_096;
const TRUSTED_TASK_ENVIRONMENT_KEYS = [
  'EMDASH_DEFAULT_BRANCH',
  'EMDASH_PORT',
  'EMDASH_ROOT_PATH',
  'EMDASH_TASK_ID',
  'EMDASH_TASK_NAME',
  'EMDASH_TASK_PATH',
] as const;
const trustedTaskEnvironmentSchema = z.record(z.string(), z.string());
const e2eSessionInfoSchema = z
  .object({
    attemptId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    conversationId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    purpose: z.literal('e2e'),
    phaseId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    verificationRunId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    attempt: z.number().int().positive().max(MAX_ATTEMPTS),
    target: loopSessionTargetSchema,
    provider: loopProviderSchema,
    model: z.string().trim().min(1).max(MAX_MODEL_LENGTH),
    taskEnvironment: trustedTaskEnvironmentSchema,
  })
  .strict();
const e2ePromptResultSchema = z
  .object({
    attemptId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    conversationId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    purpose: z.literal('e2e'),
    phaseId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    verificationRunId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    attempt: z.number().int().positive().max(MAX_ATTEMPTS),
    target: loopSessionTargetSchema,
    finalText: z.string().max(512 * 1024),
  })
  .strict();
const e2eRequiredChecksResultSchema = z
  .object({
    status: z.enum(['passed', 'correctable', 'failed']),
    loopId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    phaseId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    fullChecksRan: z.literal(true),
    verificationRunId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    attempt: z.number().int().positive().max(MAX_ATTEMPTS),
    outerConversationId: z.string().trim().min(1).max(MAX_ID_LENGTH),
    target: loopSessionTargetSchema,
    executionTarget: loopSessionTargetSchema,
    checkpointCommit: loopCommitSchema,
    provider: loopProviderSchema,
    model: z.string().trim().min(1).max(MAX_MODEL_LENGTH),
    validationCommands: validationCommandsSchema,
    criteria: e2eCriteriaSchema,
    taskEnvironment: trustedTaskEnvironmentSchema,
    requiredTestsSummary: z.string().max(MAX_SUMMARY_LENGTH),
    nativeBrowserRan: z.literal(true),
    nativePreview: z
      .object({
        invocationCount: z.number().int().nonnegative().max(MAX_ATTEMPTS),
        passed: z.boolean(),
        summary: z.string().max(MAX_SUMMARY_LENGTH),
        target: loopSessionTargetSchema,
        provider: loopProviderSchema,
        model: z.string().trim().min(1).max(MAX_MODEL_LENGTH),
        taskEnvironment: trustedTaskEnvironmentSchema,
      })
      .strict(),
    nativeEvidence: z
      .object({
        runId: z.string().trim().min(1).max(MAX_ID_LENGTH),
        artifacts: z.array(loopArtifactReferenceSchema).max(64),
      })
      .strict(),
    sessionAttempts: z.array(loopSessionAttemptSchema).max(1_024),
    handoff: loopPromptHandoffSchema.optional(),
  })
  .strict();

export type E2EGateDependencyError = {
  type?: string;
  kind?: string;
  message: string;
  pendingCleanup?: unknown;
  sessionAttempts?: unknown;
  quiescent?: boolean;
  recoveryRequired?: boolean;
};

export type E2ERequiredChecksError = E2EGateDependencyError;

export type E2EAttemptAuthority = {
  target: LoopSessionTarget;
  headCommit: string;
  clean: boolean;
  branchAttached: boolean;
  mutationBaseline: string;
};

export type E2EAttemptInspection = E2EAttemptAuthority & {
  mutated: boolean;
};

export type E2EFeatureInspection = {
  target: LoopSessionTarget;
  headCommit: string;
  clean: boolean;
  branchAttached: boolean;
};

export type E2EExecutionBinding = {
  target: LoopSessionTarget;
  taskEnvironment: Readonly<Record<string, string>>;
  executionTarget: LoopExecutionTarget;
};

export type E2ESessionInfo = {
  attemptId: string;
  conversationId: string;
  purpose: 'e2e';
  phaseId: string;
  verificationRunId: string;
  attempt: number;
  target: LoopSessionTarget;
  provider: LoopProviderId;
  model: string;
  taskEnvironment: Readonly<Record<string, string>>;
};

export type E2EPromptResult = {
  attemptId: string;
  conversationId: string;
  purpose: 'e2e';
  phaseId: string;
  verificationRunId: string;
  attempt: number;
  target: LoopSessionTarget;
  finalText: string;
};

export type E2ERequiredChecksResult = {
  status: 'passed' | 'correctable' | 'failed';
  loopId: string;
  phaseId: string;
  fullChecksRan: true;
  verificationRunId: string;
  attempt: number;
  outerConversationId: string;
  target: LoopSessionTarget;
  executionTarget: LoopSessionTarget;
  checkpointCommit: string;
  provider: LoopProviderId;
  model: string;
  validationCommands: readonly string[];
  criteria: readonly LoopPhaseCriterion[];
  taskEnvironment: Readonly<Record<string, string>>;
  requiredTestsSummary: string;
  nativeBrowserRan: true;
  nativePreview: {
    invocationCount: number;
    passed: boolean;
    summary: string;
    target: LoopSessionTarget;
    provider: LoopProviderId;
    model: string;
    taskEnvironment: Readonly<Record<string, string>>;
  };
  nativeEvidence: {
    runId: string;
    artifacts: readonly LoopArtifactReference[];
  };
  sessionAttempts: readonly LoopSessionAttempt[];
  handoff?: LoopPromptHandoff;
};

export type E2ECleanRoomPort = {
  create(input: {
    verificationRunId: string;
    attempt: number;
    task: { id: string; name: string };
    project: CleanRoomProject;
    featureTarget: LoopSessionTarget;
    baseCommit: string;
    expectedFeatureHead: string;
    requirePreview: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<Result<CleanRoomWorkspace, E2EGateDependencyError>>;
  integrateFix(input: {
    cleanRoom: CleanRoomWorkspace;
    featureTarget: LoopSessionTarget;
    expectedFeatureHead: string;
    fixCommit: string;
    project: CleanRoomProject;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<Result<{ featureHead: string }, E2EGateDependencyError>>;
  destroy(
    cleanRoom: CleanRoomWorkspace,
    project: CleanRoomProject
  ): Promise<Result<void, E2EGateDependencyError>>;
};

export type E2EAuthorityPort = {
  beginAttempt(input: {
    cleanRoom: CleanRoomWorkspace;
    target: LoopSessionTarget;
    expectedFeatureHead: string;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): Promise<Result<E2EAttemptAuthority, E2EGateDependencyError>>;
  inspectAttempt(input: {
    cleanRoom: CleanRoomWorkspace;
    target: LoopSessionTarget;
    expectedFeatureHead: string;
    mutationBaseline: string;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): Promise<Result<E2EAttemptInspection, E2EGateDependencyError>>;
  inspectFeature(input: {
    target: LoopSessionTarget;
    expectedFeatureHead: string;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): Promise<Result<E2EFeatureInspection, E2EGateDependencyError>>;
};

export type E2EExecutionPort = {
  acquire(input: {
    cleanRoom: CleanRoomWorkspace;
    task: { id: string; name: string };
    project: CleanRoomProject;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): Promise<Result<E2EExecutionBinding, E2EGateDependencyError>>;
  release(input: {
    target: LoopSessionTarget;
    executionTarget: LoopExecutionTarget;
  }): Promise<Result<{ target: LoopSessionTarget; released: true }, E2EGateDependencyError>>;
};

export type E2ESessionPort = {
  startFreshE2ESession(input: {
    attemptId: string;
    conversationId: string;
    purpose: 'e2e';
    phaseId: string;
    verificationRunId: string;
    attempt: number;
    target: LoopSessionTarget;
    executionTarget: LoopExecutionTarget;
    taskEnvironment: Readonly<Record<string, string>>;
    provider: LoopProviderId;
    model: string;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): Promise<Result<E2ESessionInfo, E2EGateDependencyError>>;
  sendE2EPrompt(input: {
    attemptId: string;
    conversationId: string;
    purpose: 'e2e';
    phaseId: string;
    verificationRunId: string;
    attempt: number;
    target: LoopSessionTarget;
    prompt: string;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): Promise<Result<E2EPromptResult, E2EGateDependencyError>>;
  cancelE2ESession(input: {
    attemptId: string;
    conversationId: string;
    purpose: 'e2e';
    phaseId: string;
    verificationRunId: string;
    attempt: number;
    target: LoopSessionTarget;
  }): Promise<
    Result<
      {
        attemptId: string;
        conversationId: string;
        purpose: 'e2e';
        phaseId: string;
        verificationRunId: string;
        attempt: number;
        target: LoopSessionTarget;
        quiescent: true;
      },
      E2EGateDependencyError
    >
  >;
};

export type E2ERequiredChecksPort = {
  /**
   * Every settlement, including rejection, occurs only after CLI, native-browser, nested ACP,
   * evidence, and cancellation effects are quiescent. The gate waits settlement after stop.
   */
  run(input: {
    authority: {
      loopId: string;
      projectId: string;
      taskId: string;
      phaseId: string;
      outerConversationId: string;
      progress: E2EDurableProgress;
    };
    validationCommands: readonly string[];
    criteria: readonly LoopPhaseCriterion[];
    verificationRunId: string;
    attempt: number;
    sessionIdentity: {
      attemptId: string;
      conversationId: string;
    };
    target: LoopSessionTarget;
    executionTarget: LoopExecutionTarget;
    taskEnvironment: Readonly<Record<string, string>>;
    checkpointCommit: string;
    provider: LoopProviderId;
    model: string;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): Promise<Result<E2ERequiredChecksResult, E2ERequiredChecksError>>;
};

export type CleanRoomE2EGateDependencies = {
  cleanRoom: E2ECleanRoomPort;
  authority: E2EAuthorityPort;
  execution: E2EExecutionPort;
  session: E2ESessionPort;
  requiredChecks: E2ERequiredChecksPort;
  progress: E2EProgressPort;
  prerequisites: {
    resolve(input: {
      loopId: string;
      phaseId: string;
      terminalGates: LoopTerminalGates;
    }): Promise<Result<{ phases: readonly LoopPhase[] }, E2EGateDependencyError>>;
  };
  createVerificationRunId(attempt: number): string;
  createSessionIdentity(input: {
    purpose: 'e2e' | 'browser-verification';
    verificationRunId: string;
    attempt: number;
  }): {
    attemptId: string;
    conversationId: string;
  };
  now(): Date;
};

export type RunCleanRoomE2EGateInput = LoopPromptContextInput & {
  loop: Loop;
  phase: LoopPhase;
  task: { id: string; name: string };
  project: CleanRoomProject;
  featureTarget: LoopSessionTarget;
  provider: LoopProviderId;
  model: string;
  terminalGates: LoopTerminalGates;
  intermediateFailures: readonly LoopPromptHandoff[];
  signal?: AbortSignal;
  deadlineAt?: number;
};

export type CleanRoomE2EGateOutput = {
  purpose: 'e2e';
  previousFeatureHead: string;
  featureHead: string;
  attempts: number;
  correctionCount: number;
  lastWorkspaceDestroyed: true;
  requiredTestsSummary: string;
  nativePreviewSummary: string;
  nativeEvidence: {
    runId: string;
    artifacts: LoopArtifactReference[];
  };
  verificationRunIds: string[];
  sessionAttempts: LoopSessionAttempt[];
  intermediateFailures: LoopPromptHandoff[];
  stageResult: LoopStageResult;
};

export type E2EPendingWorkspaceAuthority = {
  projectId: string;
  cleanupId: string;
  verificationRunId: string;
  attempt: number;
  target: LoopSessionTarget;
  expectedFeatureHead: string;
};

export type CleanRoomE2EGateStage =
  | 'precondition'
  | 'create'
  | 'execution'
  | 'authority'
  | 'session-start'
  | 'prompt'
  | 'quiescence'
  | 'inspect'
  | 'correction'
  | 'required-checks'
  | 'progress'
  | 'cleanup'
  | 'finalize';

export type CleanRoomE2EGateError = {
  type: string;
  stage: CleanRoomE2EGateStage;
  message: string;
  featureHead: string;
  attempt: number;
  verificationRunId?: string;
  conversationId?: string;
  recoveryRequired?: boolean;
  pendingCleanup?: CleanRoomPendingCleanup;
  pendingWorkspace?: E2EPendingWorkspaceAuthority;
  lastWorkspaceDestroyed?: boolean;
  sessionAttempts: LoopSessionAttempt[];
  intermediateFailures: LoopPromptHandoff[];
  stageResult: LoopStageResult;
};

export type ActiveAttempt = {
  number: number;
  verificationRunId: string;
  cleanRoom: CleanRoomWorkspace;
  binding: E2EExecutionBinding;
  authority: E2EAttemptAuthority;
  session: E2ESessionInfo;
  outerLedgerIndex: number;
};

type CleanupResult = Result<void, CleanRoomE2EGateError>;

type StopQuiescence<T> = (
  operation: Promise<Extract<ControlledDependencyOutcome<T>, { kind: 'completed' }>>
) => Promise<Result<void, E2EGateDependencyError>>;

type E2ERunLifecycle = {
  input?: NormalizedInput;
  integrationLinearized: boolean;
  finalAuthorityInspected: boolean;
};

export class CleanRoomE2EGate {
  constructor(private readonly dependencies: CleanRoomE2EGateDependencies) {}

  async run(
    rawInput: RunCleanRoomE2EGateInput
  ): Promise<Result<CleanRoomE2EGateOutput, CleanRoomE2EGateError>> {
    const lifecycle: E2ERunLifecycle = {
      integrationLinearized: false,
      finalAuthorityInspected: false,
    };
    const result = await this.runCore(rawInput, lifecycle);
    const reconciled = await this.reconcileTerminalAfterIntegration(result, lifecycle);
    if (!lifecycle.input) return reconciled;
    return this.persistTerminalOutcome(reconciled, lifecycle.input);
  }

  private async runCore(
    rawInput: RunCleanRoomE2EGateInput,
    lifecycle: E2ERunLifecycle
  ): Promise<Result<CleanRoomE2EGateOutput, CleanRoomE2EGateError>> {
    const normalized = safeNormalizeInput(rawInput);
    if (!normalized.success) {
      return err(
        this.failure(
          { intermediateFailures: [] },
          normalized.error.type,
          'precondition',
          normalized.error.message,
          {
            featureHead: '',
            attempt: 0,
            sessionAttempts: [],
          }
        )
      );
    }
    let input = normalized.data;
    lifecycle.input = input;
    const promptPreflightError = preflightAggregateE2EPrompt(input);
    if (promptPreflightError) {
      return err(
        this.failure(input, 'invalid-input', 'precondition', promptPreflightError, {
          featureHead: input.checkpointCommit,
          attempt: 0,
          sessionAttempts: [],
        })
      );
    }
    const precondition = terminalPrecondition(input);
    if (precondition) {
      return err(
        this.failure(input, precondition.type, 'precondition', precondition.message, {
          featureHead: input.checkpointCommit,
          attempt: 0,
          sessionAttempts: [],
        })
      );
    }

    const stoppedBeforeDependencies = controlFailure(input);
    if (stoppedBeforeDependencies) {
      return err(
        this.failure(
          input,
          stoppedBeforeDependencies.type,
          'precondition',
          stoppedBeforeDependencies.message,
          {
            featureHead: input.checkpointCommit,
            attempt: 0,
            sessionAttempts: [],
          }
        )
      );
    }

    const prerequisites = await this.callDependency(
      'E2E durable prerequisites',
      () =>
        this.dependencies.prerequisites.resolve({
          loopId: input.loop.id,
          phaseId: input.phase.id,
          terminalGates: { ...input.terminalGates },
        }),
      stabilizePlainSuccess<{ phases: readonly LoopPhase[] }>
    );
    if (!prerequisites.success) {
      return err(
        this.dependencyFailure(
          input,
          prerequisites.error,
          'precondition',
          input.checkpointCommit,
          0,
          []
        )
      );
    }
    const prerequisiteError = validatePrerequisites(prerequisites.data, input);
    if (prerequisiteError) {
      return err(
        this.failure(input, prerequisiteError.type, 'precondition', prerequisiteError.message, {
          featureHead: input.checkpointCommit,
          attempt: 0,
          sessionAttempts: [],
        })
      );
    }

    const defaultBranch = await this.callDependency(
      'E2E project default branch authority',
      async () => {
        try {
          return ok(await input.project.settings.getDefaultBranch());
        } catch (cause) {
          return err({ message: errorMessage(cause) });
        }
      },
      stabilizePlainSuccess<string>
    );
    if (
      !defaultBranch.success ||
      typeof defaultBranch.data !== 'string' ||
      defaultBranch.data !== defaultBranch.data.trim() ||
      defaultBranch.data.length === 0 ||
      defaultBranch.data.length > MAX_ID_LENGTH ||
      redactPersistedText(defaultBranch.data) !== defaultBranch.data
    ) {
      const message = defaultBranch.success
        ? 'Project default branch authority was invalid.'
        : defaultBranch.error.message;
      return err(
        this.failure(input, 'dependency-rejected', 'execution', message, {
          featureHead: input.checkpointCommit,
          attempt: 0,
          recoveryRequired: true,
          sessionAttempts: [],
        })
      );
    }
    const effectiveDefaultBranch = defaultBranch.data;

    let featureHead = input.checkpointCommit;
    let correctionCount = input.intermediateFailures.filter(
      (handoff) => handoff.source === 'Clean-room E2E correction'
    ).length;
    const intermediateFailures = [...input.intermediateFailures];
    const sessionAttempts: LoopSessionAttempt[] = [];
    const verificationRunIds = durableE2EVerificationRunIds(
      input.previousSessionAttempts,
      input.phase.id
    );
    const cancellationPromises: E2ECancellationRegistry = new Map();

    const consumedAttempts = input.e2eAttemptsConsumed;
    if (consumedAttempts >= CLEAN_ROOM_E2E_MAX_ATTEMPTS) {
      return err(
        this.failure(
          input,
          'attempts-exhausted',
          'finalize',
          'The durable E2E attempt cap was already exhausted.',
          {
            featureHead,
            attempt: consumedAttempts,
            sessionAttempts,
          }
        )
      );
    }

    for (let attempt = consumedAttempts + 1; attempt <= CLEAN_ROOM_E2E_MAX_ATTEMPTS; attempt += 1) {
      if (lifecycle.integrationLinearized) lifecycle.finalAuthorityInspected = false;
      const stopped = controlFailure(input);
      if (stopped) {
        return err(
          this.failure(input, stopped.type, 'precondition', stopped.message, {
            featureHead,
            attempt,
            sessionAttempts,
          })
        );
      }

      let verificationRunId: string;
      try {
        verificationRunId = this.dependencies.createVerificationRunId(attempt);
      } catch (cause) {
        return err(
          this.failure(
            input,
            'dependency-rejected',
            'create',
            `Verification run ID allocation failed: ${errorMessage(cause)}`,
            {
              featureHead,
              attempt,
              sessionAttempts,
            }
          )
        );
      }
      if (
        !validId(verificationRunId) ||
        verificationRunIds.includes(verificationRunId) ||
        input.previousSessionAttempts.some(
          (previous) => previous.verificationRunId === verificationRunId
        ) ||
        input.loop.state?.verification?.verificationRunId === verificationRunId
      ) {
        return err(
          this.failure(
            input,
            'invalid-verification-run',
            'create',
            'Invalid verification run ID.',
            {
              featureHead,
              attempt,
              sessionAttempts,
            }
          )
        );
      }
      verificationRunIds.push(verificationRunId);

      const preparing = await this.commitWorkspaceProgress(
        input,
        verificationProgress({
          currentVerification: input.progress.current.loopState.verification,
          verificationRunId,
          attempt,
          status: 'preparing',
          baseCommit: input.baseCommit,
          featureHead,
          updatedAt: safeNow(this.dependencies.now),
        }),
        featureHead,
        attempt,
        sessionAttempts
      );
      if (!preparing.success) return preparing;

      const created = await this.callDependency(
        'Clean-room creation',
        () =>
          this.dependencies.cleanRoom.create({
            verificationRunId,
            attempt,
            task: input.task,
            project: input.project,
            featureTarget: copyTarget(input.featureTarget),
            baseCommit: input.baseCommit,
            expectedFeatureHead: featureHead,
            requirePreview: true,
            signal: input.signal,
            timeoutMs: remainingTimeout(input),
          }),
        stabilizePlainSuccess<CleanRoomWorkspace>
      );
      if (!created.success) {
        const pendingCleanup = safeCreatePendingCleanup(
          created.error.pendingCleanup,
          input,
          verificationRunId,
          attempt,
          featureHead
        );
        const recoveryRequired =
          created.error.recoveryRequired === true ||
          created.error.quiescent === false ||
          created.error.type === 'untrusted-settlement' ||
          created.error.type === 'cleanup-failed' ||
          pendingCleanup !== undefined;
        if (!recoveryRequired) {
          const createProgress = await this.commitWorkspaceProgress(
            input,
            null,
            featureHead,
            attempt,
            sessionAttempts
          );
          if (!createProgress.success) return createProgress;
        }
        return err(
          this.dependencyFailure(
            input,
            created.error,
            'create',
            featureHead,
            attempt,
            sessionAttempts,
            {
              verificationRunId,
              ...(recoveryRequired
                ? { recoveryRequired: true, lastWorkspaceDestroyed: false }
                : { lastWorkspaceDestroyed: true }),
              ...(pendingCleanup
                ? {
                    pendingCleanup,
                    pendingWorkspace: pendingWorkspaceFromCleanup(pendingCleanup),
                  }
                : {}),
            }
          )
        );
      }
      const cleanRoom = created.data;
      const cleanRoomError = validateCleanRoom(
        cleanRoom,
        input,
        verificationRunId,
        attempt,
        featureHead
      );
      if (cleanRoomError) {
        return err(
          this.failure(input, cleanRoomError.type, 'create', cleanRoomError.message, {
            featureHead,
            attempt,
            verificationRunId,
            recoveryRequired: true,
            lastWorkspaceDestroyed: false,
            sessionAttempts,
          })
        );
      }
      const ready = await this.commitWorkspaceProgress(
        input,
        verificationProgress({
          currentVerification: input.progress.current.loopState.verification,
          verificationRunId,
          attempt,
          status: 'ready',
          baseCommit: input.baseCommit,
          featureHead,
          updatedAt: safeNow(this.dependencies.now),
          cleanRoom,
        }),
        featureHead,
        attempt,
        sessionAttempts
      );
      if (!ready.success) {
        const destroyed = await this.destroyOnly(
          input,
          cleanRoom,
          featureHead,
          attempt,
          sessionAttempts
        );
        if (!destroyed.success) return destroyed;
        return ready;
      }
      const stoppedAfterCreate = controlFailure(input);
      if (stoppedAfterCreate) {
        const destroyed = await this.destroyOnly(
          input,
          cleanRoom,
          featureHead,
          attempt,
          sessionAttempts
        );
        if (!destroyed.success) return destroyed;
        return err(
          this.failure(input, stoppedAfterCreate.type, 'create', stoppedAfterCreate.message, {
            featureHead,
            attempt,
            verificationRunId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }

      const acquired = await this.callDependency(
        'Clean-room execution binding',
        () =>
          this.dependencies.execution.acquire({
            cleanRoom,
            task: input.task,
            project: input.project,
            signal: input.signal,
            deadlineAt: input.deadlineAt,
          }),
        stabilizeExecutionBinding
      );
      if (!acquired.success) {
        if (
          acquired.error.type === 'untrusted-settlement' ||
          acquired.error.type === 'cleanup-failed' ||
          acquired.error.recoveryRequired === true ||
          acquired.error.quiescent === false
        ) {
          return err(
            this.dependencyFailure(
              input,
              acquired.error,
              'execution',
              featureHead,
              attempt,
              sessionAttempts,
              {
                verificationRunId,
                recoveryRequired: true,
                lastWorkspaceDestroyed: false,
                pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
              }
            )
          );
        }
        const destroyed = await this.destroyOnly(
          input,
          cleanRoom,
          featureHead,
          attempt,
          sessionAttempts
        );
        if (!destroyed.success) return destroyed;
        return err(
          this.dependencyFailure(
            input,
            acquired.error,
            'execution',
            featureHead,
            attempt,
            sessionAttempts,
            { verificationRunId, lastWorkspaceDestroyed: true }
          )
        );
      }
      const binding = acquired.data;
      const bindingError = validateBinding(
        binding,
        cleanRoom.target,
        input,
        effectiveDefaultBranch
      );
      if (bindingError) {
        if (!bindingError.safeToRelease) {
          return err(
            this.failure(input, bindingError.type, 'execution', bindingError.message, {
              featureHead,
              attempt,
              verificationRunId,
              recoveryRequired: true,
              lastWorkspaceDestroyed: false,
              pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
              sessionAttempts,
            })
          );
        }
        const cleanup = await this.cleanup(
          input,
          cleanRoom,
          binding,
          featureHead,
          attempt,
          sessionAttempts
        );
        if (!cleanup.success) return cleanup;
        return err(
          this.failure(input, bindingError.type, 'execution', bindingError.message, {
            featureHead,
            attempt,
            verificationRunId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }
      const stoppedAfterAcquire = controlFailure(input);
      if (stoppedAfterAcquire) {
        const cleanup = await this.cleanup(
          input,
          cleanRoom,
          binding,
          featureHead,
          attempt,
          sessionAttempts
        );
        if (!cleanup.success) return cleanup;
        return err(
          this.failure(input, stoppedAfterAcquire.type, 'execution', stoppedAfterAcquire.message, {
            featureHead,
            attempt,
            verificationRunId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }

      const begun = await this.callDependency(
        'E2E attempt authority',
        () =>
          this.dependencies.authority.beginAttempt({
            cleanRoom,
            target: copyTarget(cleanRoom.target),
            expectedFeatureHead: featureHead,
            signal: input.signal,
            deadlineAt: input.deadlineAt,
          }),
        stabilizePlainSuccess<E2EAttemptAuthority>
      );
      if (!begun.success) {
        const cleanup = await this.cleanup(
          input,
          cleanRoom,
          binding,
          featureHead,
          attempt,
          sessionAttempts
        );
        if (!cleanup.success) return cleanup;
        return err(
          this.dependencyFailure(
            input,
            begun.error,
            'authority',
            featureHead,
            attempt,
            sessionAttempts,
            { verificationRunId, lastWorkspaceDestroyed: true }
          )
        );
      }
      const authorityError = validateBeginning(begun.data, cleanRoom.target, featureHead);
      if (authorityError) {
        const cleanup = await this.cleanup(
          input,
          cleanRoom,
          binding,
          featureHead,
          attempt,
          sessionAttempts
        );
        if (!cleanup.success) return cleanup;
        return err(
          this.failure(input, authorityError.type, 'authority', authorityError.message, {
            featureHead,
            attempt,
            verificationRunId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }
      const stoppedAfterAuthority = controlFailure(input);
      if (stoppedAfterAuthority) {
        const cleanup = await this.cleanup(
          input,
          cleanRoom,
          binding,
          featureHead,
          attempt,
          sessionAttempts
        );
        if (!cleanup.success) return cleanup;
        return err(
          this.failure(
            input,
            stoppedAfterAuthority.type,
            'authority',
            stoppedAfterAuthority.message,
            {
              featureHead,
              attempt,
              verificationRunId,
              lastWorkspaceDestroyed: true,
              sessionAttempts,
            }
          )
        );
      }

      const outerSessionOperations: OuterSessionBootstrapOperations = {
        dependencies: this.dependencies,
        callControlled: this.callControlled.bind(this),
        cancelAllSessions: this.cancelAllSessions.bind(this),
        cancelSession: this.cancelSession.bind(this),
        cleanup: this.cleanup.bind(this),
        cleanupActive: this.cleanupActive.bind(this),
        commitWorkspaceProgress: this.commitWorkspaceProgress.bind(this),
        dependencyFailure: this.dependencyFailure.bind(this),
        failure: this.failure.bind(this),
        reserveUnexpectedOuterAttempt: this.reserveUnexpectedOuterAttempt.bind(this),
        retryUnexpectedStartingProgress: this.retryUnexpectedStartingProgress.bind(this),
        syncSessionProgress: this.syncSessionProgress.bind(this),
        validateSession,
      };
      const bootstrapped = await bootstrapOuterSession(
        input,
        featureHead,
        attempt,
        verificationRunId,
        cleanRoom,
        binding,
        begun.data,
        sessionAttempts,
        cancellationPromises,
        outerSessionOperations
      );
      if (!bootstrapped.success) return bootstrapped;
      const active = bootstrapped.data;
      const { outerLedgerIndex, session } = active;

      let prompt: string;
      try {
        prompt = buildE2EPrompt({
          goal: input.goal,
          acceptanceCriteria: [...input.acceptanceCriteria],
          baseCommit: input.baseCommit,
          checkpointCommit: featureHead,
          handoffs: [...input.handoffs],
          verificationRunId,
          verificationTarget: copyTarget(cleanRoom.target),
          attempt,
          intermediateFailures,
        });
      } catch (cause) {
        const cancelled = await this.cancelSession(session, cleanRoom.target, cancellationPromises);
        if (!cancelled.success) {
          markOuterAttempt(
            sessionAttempts,
            outerLedgerIndex,
            'interrupted',
            safeDate(this.dependencies.now),
            { error: cancelled.error.message }
          );
          return err(
            this.dependencyFailure(
              input,
              cancelled.error,
              'quiescence',
              featureHead,
              attempt,
              sessionAttempts,
              {
                verificationRunId,
                conversationId: session.conversationId,
                recoveryRequired: true,
                lastWorkspaceDestroyed: false,
                pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
              }
            )
          );
        }
        const message = `E2E prompt construction failed: ${errorMessage(cause)}`;
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'failed',
          safeDate(this.dependencies.now),
          {
            error: message,
          }
        );
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
        return err(
          this.failure(input, 'invalid-input', 'prompt', message, {
            featureHead,
            attempt,
            verificationRunId,
            conversationId: session.conversationId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }
      const prompted = await this.callControlled(
        input,
        'E2E prompt',
        () =>
          this.dependencies.session.sendE2EPrompt({
            attemptId: session.attemptId,
            conversationId: session.conversationId,
            purpose: session.purpose,
            phaseId: session.phaseId,
            verificationRunId,
            attempt,
            target: copyTarget(cleanRoom.target),
            prompt,
            signal: input.signal,
            deadlineAt: input.deadlineAt,
          }),
        async () => this.cancelSession(session, cleanRoom.target, cancellationPromises),
        stabilizePlainSuccess<E2EPromptResult>
      );

      const cancelled = await this.cancelSession(session, cleanRoom.target, cancellationPromises);
      if (!cancelled.success) {
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'interrupted',
          safeDate(this.dependencies.now),
          {
            error: 'E2E session did not prove quiescence.',
          }
        );
        return err(
          this.dependencyFailure(
            input,
            cancelled.error,
            'quiescence',
            featureHead,
            attempt,
            sessionAttempts,
            {
              verificationRunId,
              conversationId: session.conversationId,
              recoveryRequired: true,
              lastWorkspaceDestroyed: false,
              pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
            }
          )
        );
      }
      if (!prompted.success) {
        const promptAttemptStatus =
          prompted.error.type === 'cancelled' || prompted.error.kind === 'cancelled'
            ? 'cancelled'
            : prompted.error.type === 'deadline-exceeded' ||
                prompted.error.kind === 'deadline-exceeded'
              ? 'interrupted'
              : 'failed';
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          promptAttemptStatus,
          safeDate(this.dependencies.now),
          {
            error: prompted.error.message,
          }
        );
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
        return err(
          this.dependencyFailure(
            input,
            prompted.error,
            'prompt',
            featureHead,
            attempt,
            sessionAttempts,
            {
              verificationRunId,
              conversationId: session.conversationId,
              lastWorkspaceDestroyed: true,
            }
          )
        );
      }
      const promptEcho = validatePromptResult(prompted.data, session);
      if (promptEcho) {
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'failed',
          safeDate(this.dependencies.now),
          {
            error: promptEcho.message,
          }
        );
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
        return err(
          this.failure(input, promptEcho.type, 'prompt', promptEcho.message, {
            featureHead,
            attempt,
            verificationRunId,
            conversationId: session.conversationId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }

      const inspected = await this.callDependency(
        'Post-prompt E2E authority',
        () =>
          this.dependencies.authority.inspectAttempt({
            cleanRoom,
            target: copyTarget(cleanRoom.target),
            expectedFeatureHead: featureHead,
            mutationBaseline: begun.data.mutationBaseline,
            signal: input.signal,
            deadlineAt: input.deadlineAt,
          }),
        stabilizePlainSuccess<E2EAttemptInspection>
      );
      if (!inspected.success) {
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'failed',
          safeDate(this.dependencies.now),
          {
            error: inspected.error.message,
          }
        );
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
        return err(
          this.dependencyFailure(
            input,
            inspected.error,
            'inspect',
            featureHead,
            attempt,
            sessionAttempts,
            {
              verificationRunId,
              conversationId: session.conversationId,
              recoveryRequired: true,
              lastWorkspaceDestroyed: true,
            }
          )
        );
      }
      const inspectionError = validateInspection(
        inspected.data,
        cleanRoom.target,
        begun.data.mutationBaseline
      );
      if (inspectionError) {
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'failed',
          safeDate(this.dependencies.now),
          {
            error: inspectionError.message,
          }
        );
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
        return err(
          this.failure(input, inspectionError.type, 'inspect', inspectionError.message, {
            featureHead,
            attempt,
            verificationRunId,
            conversationId: session.conversationId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }
      const stoppedAfterInspection = controlFailure(input);
      if (stoppedAfterInspection) {
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          stoppedAfterInspection.type === 'cancelled' ? 'cancelled' : 'interrupted',
          safeDate(this.dependencies.now),
          { error: stoppedAfterInspection.message }
        );
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
        return err(
          this.failure(
            input,
            stoppedAfterInspection.type,
            'inspect',
            stoppedAfterInspection.message,
            {
              featureHead,
              attempt,
              verificationRunId,
              conversationId: session.conversationId,
              lastWorkspaceDestroyed: true,
              sessionAttempts,
            }
          )
        );
      }
      const sentinel = parseE2ESentinel(prompted.data.finalText);
      if (!sentinel) {
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'failed',
          safeDate(this.dependencies.now),
          {
            error: 'Malformed E2E sentinel.',
          }
        );
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
        return err(
          this.failure(input, 'malformed-sentinel', 'prompt', 'Malformed E2E sentinel.', {
            featureHead,
            attempt,
            verificationRunId,
            conversationId: session.conversationId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }

      if (sentinel.kind === 'failed') {
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'failed',
          safeDate(this.dependencies.now),
          {
            error: sentinel.reason,
          }
        );
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
        return err(
          this.failure(input, 'e2e-failed', 'prompt', sentinel.reason, {
            featureHead,
            attempt,
            verificationRunId,
            conversationId: session.conversationId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }

      if (sentinel.kind === 'correction-ready') {
        const correctionError = validateCorrectionInspection(inspected.data, featureHead);
        if (correctionError) {
          markOuterAttempt(
            sessionAttempts,
            outerLedgerIndex,
            'failed',
            safeDate(this.dependencies.now),
            {
              error: correctionError.message,
            }
          );
          const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
          if (!cleanup.success) return cleanup;
          return err(
            this.failure(input, correctionError.type, 'correction', correctionError.message, {
              featureHead,
              attempt,
              verificationRunId,
              conversationId: session.conversationId,
              lastWorkspaceDestroyed: true,
              sessionAttempts,
            })
          );
        }
        if (intermediateFailures.length >= 64) {
          markOuterAttempt(
            sessionAttempts,
            outerLedgerIndex,
            'failed',
            safeDate(this.dependencies.now),
            {
              error: 'The bounded intermediate-failure ledger is full.',
            }
          );
          const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
          if (!cleanup.success) return cleanup;
          return err(
            this.failure(
              input,
              'evidence-ledger-full',
              'correction',
              'A correction cannot be integrated after the bounded failure ledger is full.',
              {
                featureHead,
                attempt,
                verificationRunId,
                conversationId: session.conversationId,
                lastWorkspaceDestroyed: true,
                sessionAttempts,
              }
            )
          );
        }
        const correctionHandoff = copyPromptHandoff({
          source: 'Clean-room E2E correction',
          handoff: {
            summary: sentinel.summary,
            risks: ['The integrated correction still requires a fresh clean-room replay.'],
            remainingWork: [
              'Recreate the clean room and independently re-run every required check.',
            ],
            artifacts: [],
            createdAt: monotonicCorrectionHandoffTimestamp(
              input,
              sessionAttempts,
              intermediateFailures,
              safeNow(this.dependencies.now)
            ),
          },
        });
        intermediateFailures.push(correctionHandoff);
        input = { ...input, intermediateFailures: [...intermediateFailures] };
        lifecycle.input = input;
        const correctionEvidenceProgress = await this.commitProgress(
          input,
          {
            kind: 'retry-handoffs',
            checkpointCommit: featureHead,
            retryHandoffs: safeCopyPromptHandoffs(intermediateFailures),
          },
          featureHead,
          attempt,
          sessionAttempts
        );
        if (!correctionEvidenceProgress.success) {
          markOuterAttempt(
            sessionAttempts,
            outerLedgerIndex,
            'interrupted',
            safeDate(this.dependencies.now),
            { error: correctionEvidenceProgress.error.message }
          );
          const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
          if (!cleanup.success) return cleanup;
          return err({ ...correctionEvidenceProgress.error, lastWorkspaceDestroyed: true });
        }
        const previousFeatureHead = featureHead;
        const correctionCleanRoom: CleanRoomWorkspace = {
          ...cleanRoom,
          target: copyTarget(cleanRoom.target),
          replayedThroughCommit: inspected.data.headCommit,
        };
        const integratingProgress = await this.commitWorkspaceProgress(
          input,
          verificationProgress({
            currentVerification: input.progress.current.loopState.verification,
            verificationRunId,
            attempt,
            status: 'integrating-fix',
            baseCommit: input.baseCommit,
            featureHead,
            updatedAt: safeNow(this.dependencies.now),
            cleanRoom: correctionCleanRoom,
          }),
          featureHead,
          attempt,
          sessionAttempts
        );
        if (!integratingProgress.success) {
          markOuterAttempt(
            sessionAttempts,
            outerLedgerIndex,
            'interrupted',
            safeDate(this.dependencies.now),
            { error: integratingProgress.error.message }
          );
          const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
          if (!cleanup.success) return cleanup;
          return err({ ...integratingProgress.error, lastWorkspaceDestroyed: true });
        }
        cleanRoom.replayedThroughCommit = correctionCleanRoom.replayedThroughCommit;
        lifecycle.integrationLinearized = true;
        const integrated = await this.callDependency(
          'E2E correction integration',
          () =>
            this.dependencies.cleanRoom.integrateFix({
              cleanRoom,
              featureTarget: copyTarget(input.featureTarget),
              expectedFeatureHead: previousFeatureHead,
              fixCommit: inspected.data.headCommit,
              project: input.project,
              signal: input.signal,
              timeoutMs: remainingTimeout(input),
            }),
          stabilizePlainSuccess<{ featureHead: string }>
        );
        if (!integrated.success) {
          markOuterAttempt(
            sessionAttempts,
            outerLedgerIndex,
            'failed',
            safeDate(this.dependencies.now),
            {
              error: integrated.error.message,
            }
          );
          const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
          if (!cleanup.success) return cleanup;
          return err(
            this.dependencyFailure(
              input,
              integrated.error,
              'correction',
              featureHead,
              attempt,
              sessionAttempts,
              {
                verificationRunId,
                conversationId: session.conversationId,
                recoveryRequired: true,
                lastWorkspaceDestroyed: true,
              }
            )
          );
        }
        if (
          !integrated.data ||
          typeof integrated.data !== 'object' ||
          !validCommit(integrated.data.featureHead) ||
          integrated.data.featureHead === previousFeatureHead
        ) {
          markOuterAttempt(
            sessionAttempts,
            outerLedgerIndex,
            'failed',
            safeDate(this.dependencies.now),
            {
              error: 'Fix integration returned invalid head authority.',
            }
          );
          const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
          if (!cleanup.success) return cleanup;
          return err(
            this.failure(
              input,
              'integration-authority-invalid',
              'correction',
              'Fix integration returned invalid head authority.',
              {
                featureHead,
                attempt,
                verificationRunId,
                conversationId: session.conversationId,
                recoveryRequired: true,
                lastWorkspaceDestroyed: true,
                sessionAttempts,
              }
            )
          );
        }
        const integratedFeature = await this.callDependency(
          'Post-integration feature authority',
          () =>
            this.dependencies.authority.inspectFeature({
              target: copyTarget(input.featureTarget),
              expectedFeatureHead: integrated.data.featureHead,
            }),
          stabilizePlainSuccess<E2EFeatureInspection>
        );
        const integratedFeatureError = integratedFeature.success
          ? validateFeature(
              integratedFeature.data,
              input.featureTarget,
              integrated.data.featureHead
            )
          : undefined;
        if (!integratedFeature.success || integratedFeatureError) {
          const message = integratedFeature.success
            ? integratedFeatureError!.message
            : integratedFeature.error.message;
          const observedFeatureHead =
            integratedFeature.success &&
            sameTarget(integratedFeature.data.target, input.featureTarget) &&
            validCommit(integratedFeature.data.headCommit)
              ? integratedFeature.data.headCommit
              : previousFeatureHead;
          markOuterAttempt(
            sessionAttempts,
            outerLedgerIndex,
            'failed',
            safeDate(this.dependencies.now),
            { error: message }
          );
          const cleanup = await this.cleanupActive(
            input,
            active,
            previousFeatureHead,
            sessionAttempts
          );
          if (!cleanup.success) return cleanup;
          return err(
            integratedFeature.success
              ? this.failure(input, integratedFeatureError!.type, 'correction', message, {
                  featureHead: observedFeatureHead,
                  attempt,
                  verificationRunId,
                  conversationId: session.conversationId,
                  recoveryRequired: true,
                  lastWorkspaceDestroyed: true,
                  sessionAttempts,
                })
              : this.dependencyFailure(
                  input,
                  integratedFeature.error,
                  'correction',
                  previousFeatureHead,
                  attempt,
                  sessionAttempts,
                  {
                    verificationRunId,
                    conversationId: session.conversationId,
                    recoveryRequired: true,
                    lastWorkspaceDestroyed: true,
                  }
                )
          );
        }
        featureHead = integrated.data.featureHead;
        correctionCount += 1;
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'completed',
          safeDate(this.dependencies.now),
          {
            checkpointAfter: featureHead,
          }
        );
        const checkpointProgress = await this.commitProgress(
          input,
          {
            kind: 'checkpoint-advanced',
            previousHead: previousFeatureHead,
            featureHead,
            completedAttempt: sessionAttempts[outerLedgerIndex],
            retryHandoffs: safeCopyPromptHandoffs(intermediateFailures),
          },
          featureHead,
          attempt,
          sessionAttempts
        );
        if (!checkpointProgress.success) {
          const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
          if (!cleanup.success) return cleanup;
          return err({
            ...checkpointProgress.error,
            recoveryRequired: true,
            lastWorkspaceDestroyed: true,
          });
        }
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
        const reconciled = await this.inspectFeatureAuthorityUncontrolled(
          input,
          featureHead,
          attempt,
          sessionAttempts,
          verificationRunId,
          session.conversationId
        );
        if (!reconciled.success) return reconciled;
        if (reconciled.data !== featureHead) {
          return err(
            this.failure(
              input,
              'feature-head-drift',
              'finalize',
              'Feature authority drifted after E2E correction integration.',
              {
                featureHead: reconciled.data,
                attempt,
                verificationRunId,
                conversationId: session.conversationId,
                recoveryRequired: true,
                lastWorkspaceDestroyed: true,
                sessionAttempts,
              }
            )
          );
        }
        lifecycle.finalAuthorityInspected = true;
        const stoppedAfterIntegration = controlFailure(input);
        if (stoppedAfterIntegration) {
          return err(
            this.failure(
              input,
              stoppedAfterIntegration.type,
              'correction',
              stoppedAfterIntegration.message,
              {
                featureHead,
                attempt,
                verificationRunId,
                conversationId: session.conversationId,
                lastWorkspaceDestroyed: true,
                sessionAttempts,
              }
            )
          );
        }
        if (attempt === CLEAN_ROOM_E2E_MAX_ATTEMPTS) {
          return err(
            this.failure(
              input,
              'attempts-exhausted',
              'finalize',
              'The E2E correction was integrated, but no fresh attempt remained to prove it.',
              {
                featureHead,
                attempt,
                verificationRunId,
                conversationId: session.conversationId,
                lastWorkspaceDestroyed: true,
                sessionAttempts,
              }
            )
          );
        }
        continue;
      }

      const candidateError = validatePassInspection(inspected.data, featureHead);
      if (candidateError) {
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'failed',
          safeDate(this.dependencies.now),
          {
            error: candidateError.message,
          }
        );
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
        return err(
          this.failure(input, candidateError.type, 'inspect', candidateError.message, {
            featureHead,
            attempt,
            verificationRunId,
            conversationId: session.conversationId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }

      let nestedIdentity: { attemptId: string; conversationId: string };
      try {
        const allocated = this.dependencies.createSessionIdentity({
          purpose: 'browser-verification',
          verificationRunId,
          attempt,
        });
        const stable = stabilizePlainSuccess<{
          attemptId: string;
          conversationId: string;
        }>(allocated);
        if (!stable) throw new TypeError('Invalid browser-verification session identity');
        nestedIdentity = stable;
      } catch (cause) {
        const message = `Browser-verification identity allocation failed: ${errorMessage(cause)}`;
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'failed',
          safeDate(this.dependencies.now),
          { error: message }
        );
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
        return err(
          this.failure(input, 'dependency-rejected', 'required-checks', message, {
            featureHead,
            attempt,
            verificationRunId,
            conversationId: session.conversationId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }
      const nestedStarting = loopSessionAttemptSchema.safeParse({
        ...nestedIdentity,
        purpose: 'browser-verification',
        phaseId: input.phase.id,
        verificationRunId,
        target: copyTarget(cleanRoom.target),
        status: 'starting',
        checkpointBefore: featureHead,
        startedAt: safeNow(this.dependencies.now),
      });
      if (
        !nestedStarting.success ||
        !validId(nestedIdentity.attemptId) ||
        !validId(nestedIdentity.conversationId) ||
        !freshAttemptIdentity(nestedStarting.data, input, sessionAttempts)
      ) {
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'failed',
          safeDate(this.dependencies.now),
          { error: 'Allocated browser-verification identities were invalid or already durable.' }
        );
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
        return err(
          this.failure(
            input,
            'invalid-session-identity',
            'required-checks',
            'Allocated browser-verification identities were invalid or already durable.',
            {
              featureHead,
              attempt,
              verificationRunId,
              conversationId: session.conversationId,
              lastWorkspaceDestroyed: true,
              sessionAttempts,
            }
          )
        );
      }
      const nestedLedgerIndex = sessionAttempts.push(nestedStarting.data) - 1;
      const nestedStartingProgress = await this.syncSessionProgress(
        input,
        featureHead,
        attempt,
        sessionAttempts
      );
      if (!nestedStartingProgress.success) {
        markNestedAttemptInterrupted(
          sessionAttempts,
          nestedLedgerIndex,
          safeNow(this.dependencies.now),
          'Browser verification did not start after its durable identity was reserved.'
        );
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'interrupted',
          safeDate(this.dependencies.now),
          { error: nestedStartingProgress.error.message }
        );
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
        return nestedStartingProgress;
      }

      let stoppedChecksSettlement: E2EGateDependencyError | E2ERequiredChecksResult | undefined;
      let stoppedChecksQuiescent = false;
      const checked = await this.callControlled(
        input,
        'Required E2E checks',
        () =>
          this.dependencies.requiredChecks.run({
            authority: {
              loopId: input.loop.id,
              projectId: input.project.projectId,
              taskId: input.task.id,
              phaseId: input.phase.id,
              outerConversationId: session.conversationId,
              progress: copyE2EDurableProgress(input.progress.current),
            },
            validationCommands: [...input.validationCommands],
            criteria: input.criteria.map(copyCriterion),
            verificationRunId,
            attempt,
            sessionIdentity: { ...nestedIdentity },
            target: copyTarget(cleanRoom.target),
            executionTarget: binding.executionTarget,
            taskEnvironment: copyEnvironment(binding.taskEnvironment),
            checkpointCommit: featureHead,
            provider: input.provider,
            model: input.model,
            signal: input.signal,
            deadlineAt: input.deadlineAt,
          }),
        async (operation) => {
          const settled = await operation;
          stoppedChecksSettlement = settled.value.success
            ? settled.value.data
            : settled.value.error;
          if (
            !settled.value.success &&
            (settled.value.error.quiescent !== true ||
              settled.value.error.recoveryRequired === true)
          ) {
            return err({ ...settled.value.error, recoveryRequired: true });
          }
          if (
            !hasCompleteTerminalNestedAuthority(
              stoppedChecksSettlement,
              nestedStarting.data,
              active,
              featureHead,
              input
            )
          ) {
            return err({
              type: 'cleanup-failed',
              message: 'Required checks did not return complete terminal session authority.',
              recoveryRequired: true,
            });
          }
          stoppedChecksQuiescent = true;
          return ok();
        },
        stabilizePlainSuccess<E2ERequiredChecksResult>
      );
      if (!checked.success) {
        const checksSettlement = stoppedChecksSettlement ?? checked.error;
        const quiescenceUnproven =
          checked.error.quiescent !== true ||
          checked.error.recoveryRequired === true ||
          (!stoppedChecksQuiescent &&
            !hasCompleteTerminalNestedAuthority(
              checked.error,
              nestedStarting.data,
              active,
              featureHead,
              input
            ));
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          quiescenceUnproven ? 'interrupted' : 'failed',
          safeDate(this.dependencies.now),
          {
            error: checked.error.message,
          }
        );
        const nestedSettled = await this.settleNestedAttemptAuthority(
          input,
          active,
          featureHead,
          attempt,
          sessionAttempts,
          nestedLedgerIndex,
          checksSettlement
        );
        if (!nestedSettled.success) {
          return err({
            ...nestedSettled.error,
            recoveryRequired: true,
            lastWorkspaceDestroyed: false,
            pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
          });
        }
        if (quiescenceUnproven) {
          const terminalPersisted = await this.syncSessionProgress(
            input,
            featureHead,
            attempt,
            sessionAttempts
          );
          const recoveryError = terminalPersisted.success
            ? this.dependencyFailure(
                input,
                checked.error,
                'quiescence',
                featureHead,
                attempt,
                sessionAttempts,
                {
                  verificationRunId,
                  conversationId: session.conversationId,
                }
              )
            : terminalPersisted.error;
          return err({
            ...recoveryError,
            recoveryRequired: true,
            lastWorkspaceDestroyed: false,
            pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
          });
        }
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
        return err(
          this.dependencyFailure(
            input,
            checked.error,
            'required-checks',
            featureHead,
            attempt,
            sessionAttempts,
            {
              verificationRunId,
              conversationId: session.conversationId,
              lastWorkspaceDestroyed: true,
            }
          )
        );
      }
      const checksError = validateRequiredChecks(
        checked.data,
        active,
        featureHead,
        input,
        sessionAttempts,
        nestedStarting.data
      );
      if (checksError) {
        const nestedAuthorityComplete = hasCompleteTerminalNestedAuthority(
          checked.data,
          nestedStarting.data,
          active,
          featureHead,
          input
        );
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          nestedAuthorityComplete ? 'failed' : 'interrupted',
          safeDate(this.dependencies.now),
          {
            error: checksError.message,
          }
        );
        const nestedSettled = await this.settleNestedAttemptAuthority(
          input,
          active,
          featureHead,
          attempt,
          sessionAttempts,
          nestedLedgerIndex,
          checked.data
        );
        if (!nestedSettled.success) {
          return err({
            ...nestedSettled.error,
            recoveryRequired: true,
            lastWorkspaceDestroyed: false,
            pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
          });
        }
        if (!nestedAuthorityComplete) {
          return err({
            ...this.failure(input, checksError.type, 'quiescence', checksError.message, {
              featureHead,
              attempt,
              verificationRunId,
              conversationId: session.conversationId,
              sessionAttempts,
            }),
            recoveryRequired: true,
            lastWorkspaceDestroyed: false,
            pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
          });
        }
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
        return err(
          this.failure(input, checksError.type, 'required-checks', checksError.message, {
            featureHead,
            attempt,
            verificationRunId,
            conversationId: session.conversationId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }
      const nestedTerminalProgress = await this.settleNestedAttemptAuthority(
        input,
        active,
        featureHead,
        attempt,
        sessionAttempts,
        nestedLedgerIndex,
        checked.data
      );
      if (!nestedTerminalProgress.success) {
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'interrupted',
          safeDate(this.dependencies.now),
          { error: nestedTerminalProgress.error.message }
        );
        return err({
          ...nestedTerminalProgress.error,
          recoveryRequired: true,
          lastWorkspaceDestroyed: false,
          pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
        });
      }

      const postChecks = await this.callDependency(
        'Post-check E2E authority',
        () =>
          this.dependencies.authority.inspectAttempt({
            cleanRoom,
            target: copyTarget(cleanRoom.target),
            expectedFeatureHead: featureHead,
            mutationBaseline: begun.data.mutationBaseline,
            signal: input.signal,
            deadlineAt: input.deadlineAt,
          }),
        stabilizePlainSuccess<E2EAttemptInspection>
      );
      if (!postChecks.success) {
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'failed',
          safeDate(this.dependencies.now),
          {
            error: postChecks.error.message,
          }
        );
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
        return err(
          this.dependencyFailure(
            input,
            postChecks.error,
            'finalize',
            featureHead,
            attempt,
            sessionAttempts,
            {
              verificationRunId,
              conversationId: session.conversationId,
              lastWorkspaceDestroyed: true,
            }
          )
        );
      }
      const postChecksError = validatePostChecks(
        postChecks.data,
        cleanRoom.target,
        begun.data.mutationBaseline,
        featureHead
      );
      if (postChecksError) {
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'failed',
          safeDate(this.dependencies.now),
          {
            error: postChecksError.message,
          }
        );
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
        return err(
          this.failure(input, postChecksError.type, 'finalize', postChecksError.message, {
            featureHead,
            attempt,
            verificationRunId,
            conversationId: session.conversationId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }

      const correctableChecks = checked.data.status === 'correctable';
      const failureLedgerFull = correctableChecks && intermediateFailures.length >= 64;
      if (correctableChecks && !failureLedgerFull) {
        intermediateFailures.push(copyPromptHandoff(checked.data.handoff!));
        input = { ...input, intermediateFailures: [...intermediateFailures] };
        lifecycle.input = input;
        const handoffProgress = await this.commitProgress(
          input,
          {
            kind: 'retry-handoffs',
            checkpointCommit: featureHead,
            retryHandoffs: safeCopyPromptHandoffs(intermediateFailures),
          },
          featureHead,
          attempt,
          sessionAttempts
        );
        if (!handoffProgress.success) {
          markOuterAttempt(
            sessionAttempts,
            outerLedgerIndex,
            'interrupted',
            safeDate(this.dependencies.now),
            { error: handoffProgress.error.message }
          );
          const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
          if (!cleanup.success) return cleanup;
          return handoffProgress;
        }
      }

      markOuterAttempt(
        sessionAttempts,
        outerLedgerIndex,
        'completed',
        safeDate(this.dependencies.now),
        {
          checkpointAfter: featureHead,
        }
      );
      const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
      if (!cleanup.success) return cleanup;

      if (correctableChecks) {
        if (failureLedgerFull) {
          return err(
            this.failure(
              input,
              'evidence-ledger-full',
              'required-checks',
              'The bounded intermediate-failure ledger cannot retain another check handoff.',
              {
                featureHead,
                attempt,
                verificationRunId,
                conversationId: session.conversationId,
                lastWorkspaceDestroyed: true,
                sessionAttempts,
              }
            )
          );
        }
        if (attempt === CLEAN_ROOM_E2E_MAX_ATTEMPTS) {
          return err(
            this.failure(
              input,
              'attempts-exhausted',
              'finalize',
              'The required checks found a correction, but no fresh attempt remained.',
              {
                featureHead,
                attempt,
                verificationRunId,
                conversationId: session.conversationId,
                lastWorkspaceDestroyed: true,
                sessionAttempts,
              }
            )
          );
        }
        continue;
      }
      if (checked.data.status === 'failed') {
        return err(
          this.failure(
            input,
            'required-checks-failed',
            'required-checks',
            boundedSummary(checked.data.requiredTestsSummary, 'Required checks failed.'),
            {
              featureHead,
              attempt,
              verificationRunId,
              conversationId: session.conversationId,
              lastWorkspaceDestroyed: true,
              sessionAttempts,
            }
          )
        );
      }

      const finalFeature = await this.callDependency(
        'Final feature authority',
        () =>
          this.dependencies.authority.inspectFeature({
            target: copyTarget(input.featureTarget),
            expectedFeatureHead: featureHead,
          }),
        stabilizePlainSuccess<E2EFeatureInspection>
      );
      if (!finalFeature.success) {
        return err(
          this.dependencyFailure(
            input,
            finalFeature.error,
            'finalize',
            featureHead,
            attempt,
            sessionAttempts,
            {
              verificationRunId,
              conversationId: session.conversationId,
              recoveryRequired: true,
              lastWorkspaceDestroyed: true,
            }
          )
        );
      }
      const finalError = validateFeature(finalFeature.data, input.featureTarget, featureHead);
      if (finalError) {
        const finalAuthority =
          finalFeature.data && typeof finalFeature.data === 'object'
            ? finalFeature.data
            : undefined;
        const observedFeatureHead =
          finalAuthority &&
          sameTarget(finalAuthority.target, input.featureTarget) &&
          validCommit(finalAuthority.headCommit)
            ? finalAuthority.headCommit
            : featureHead;
        return err(
          this.failure(input, finalError.type, 'finalize', finalError.message, {
            featureHead: observedFeatureHead,
            attempt,
            verificationRunId,
            conversationId: session.conversationId,
            recoveryRequired: true,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }
      lifecycle.finalAuthorityInspected = true;
      const stoppedAfterGreen = controlFailure(input);
      if (stoppedAfterGreen) {
        return err(
          this.failure(input, stoppedAfterGreen.type, 'finalize', stoppedAfterGreen.message, {
            featureHead,
            attempt,
            verificationRunId,
            conversationId: session.conversationId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }
      return ok({
        purpose: 'e2e',
        previousFeatureHead: input.checkpointCommit,
        featureHead,
        attempts: attempt,
        correctionCount,
        lastWorkspaceDestroyed: true,
        requiredTestsSummary: boundedSummary(
          checked.data.requiredTestsSummary,
          'Required checks passed.'
        ),
        nativePreviewSummary: boundedSummary(
          checked.data.nativePreview.summary,
          'Native preview passed.'
        ),
        nativeEvidence: {
          runId: checked.data.nativeEvidence.runId,
          artifacts: checked.data.nativeEvidence.artifacts.map((artifact) =>
            loopArtifactReferenceSchema.parse(artifact)
          ),
        },
        verificationRunIds: [...verificationRunIds],
        sessionAttempts: sessionAttempts.map(copyAttempt),
        intermediateFailures: intermediateFailures.map(copyPromptHandoff),
        stageResult: this.stageResult(
          'passed',
          correctionCount === 0
            ? 'Clean-room E2E passed without a correction.'
            : 'Clean-room E2E passed after a correction and fresh replay.'
        ),
      });
    }

    return err(
      this.failure(input, 'attempts-exhausted', 'finalize', 'E2E attempt cap was exhausted.', {
        featureHead,
        attempt: CLEAN_ROOM_E2E_MAX_ATTEMPTS,
        sessionAttempts,
      })
    );
  }

  private async reconcileTerminalAfterIntegration(
    result: Result<CleanRoomE2EGateOutput, CleanRoomE2EGateError>,
    lifecycle: E2ERunLifecycle
  ): Promise<Result<CleanRoomE2EGateOutput, CleanRoomE2EGateError>> {
    if (!lifecycle.integrationLinearized || lifecycle.finalAuthorityInspected || !lifecycle.input) {
      return result;
    }

    const featureHead = result.success ? result.data.featureHead : result.error.featureHead;
    const attempt = result.success ? result.data.attempts : result.error.attempt;
    const sessionAttempts = result.success
      ? result.data.sessionAttempts
      : result.error.sessionAttempts;
    const verificationRunId = result.success
      ? result.data.verificationRunIds.at(-1)
      : result.error.verificationRunId;
    const conversationId = sessionAttempts.at(-1)?.conversationId;
    const input: NormalizedInput = {
      ...lifecycle.input,
      intermediateFailures: result.success
        ? result.data.intermediateFailures
        : result.error.intermediateFailures,
    };
    const reconciled = await this.inspectFeatureAuthorityUncontrolled(
      input,
      featureHead,
      attempt,
      sessionAttempts,
      verificationRunId,
      conversationId
    );

    if (result.success) {
      if (!reconciled.success) return reconciled;
      if (reconciled.data !== featureHead) {
        return err(
          this.failure(
            input,
            'feature-head-drift',
            'finalize',
            'Feature authority drifted after E2E correction integration.',
            {
              featureHead: reconciled.data,
              attempt,
              ...(verificationRunId ? { verificationRunId } : {}),
              ...(conversationId ? { conversationId } : {}),
              recoveryRequired: true,
              lastWorkspaceDestroyed: true,
              sessionAttempts,
            }
          )
        );
      }
      lifecycle.finalAuthorityInspected = true;
      return result;
    }

    if (!reconciled.success) {
      return err({
        ...result.error,
        featureHead: reconciled.error.featureHead,
        recoveryRequired: true,
      });
    }
    lifecycle.finalAuthorityInspected = true;
    return err({
      ...result.error,
      featureHead: reconciled.data,
      ...(reconciled.data !== featureHead ? { recoveryRequired: true } : {}),
    });
  }

  private async persistTerminalOutcome(
    result: Result<CleanRoomE2EGateOutput, CleanRoomE2EGateError>,
    input: NormalizedInput
  ): Promise<Result<CleanRoomE2EGateOutput, CleanRoomE2EGateError>> {
    if (
      !result.success &&
      (result.error.stage === 'precondition' ||
        result.error.stage === 'progress' ||
        result.error.recoveryRequired ||
        result.error.lastWorkspaceDestroyed === false)
    ) {
      return result;
    }
    const featureHead = result.success ? result.data.featureHead : result.error.featureHead;
    if (!validCommit(featureHead)) return result;
    const attempts = result.success ? result.data.sessionAttempts : result.error.sessionAttempts;
    const intermediateFailures = result.success
      ? result.data.intermediateFailures
      : result.error.intermediateFailures;
    const stageResult = monotonicTerminalStageResult(
      result.success ? result.data.stageResult : result.error.stageResult,
      attempts,
      input.progress.current,
      intermediateFailures.at(-1)?.handoff ?? null
    );
    const normalizedResult = result.success
      ? ok({ ...result.data, stageResult })
      : err({ ...result.error, stageResult });
    const committed = await this.commitProgress(
      input,
      {
        kind: 'terminal',
        checkpointCommit: featureHead,
        handoff: intermediateFailures.at(-1)?.handoff ?? null,
        result: stageResult,
      },
      featureHead,
      result.success ? result.data.attempts : result.error.attempt,
      attempts
    );
    if (committed.success) return normalizedResult;
    return committed;
  }

  private dependencyOperation<T>(
    label: string,
    operation: () => Promise<Result<T, E2EGateDependencyError>>,
    stabilizeSuccess?: SuccessStabilizer<T>
  ): Promise<Extract<ControlledDependencyOutcome<T>, { kind: 'completed' }>> {
    return Promise.resolve()
      .then(operation)
      .then(
        (value) => ({
          kind: 'completed' as const,
          value: normalizeDependencyResult<T>(value, label, stabilizeSuccess),
        }),
        (cause) => ({
          kind: 'completed' as const,
          value: err({
            type: 'untrusted-settlement',
            message: `${label} failed: ${errorMessage(cause)}`,
          }),
        })
      );
  }

  private async callDependency<T>(
    label: string,
    operation: () => Promise<Result<T, E2EGateDependencyError>>,
    stabilizeSuccess?: SuccessStabilizer<T>
  ): Promise<Result<T, E2EGateDependencyError>> {
    return (await this.dependencyOperation(label, operation, stabilizeSuccess)).value;
  }

  private async callControlled<T>(
    input: NormalizedInput,
    label: string,
    operation: () => Promise<Result<T, E2EGateDependencyError>>,
    quiesceAfterStop: StopQuiescence<T>,
    stabilizeSuccess?: SuccessStabilizer<T>
  ): Promise<Result<T, E2EGateDependencyError>> {
    const stopped = controlFailure(input);
    if (stopped) return err(stopped);

    const operationPromise = this.dependencyOperation(label, operation, stabilizeSuccess);
    const controlled = await raceWithControl(operationPromise, input);
    if (controlled.kind === 'stopped') {
      const quiesced = await quiesceAfterStop(operationPromise);
      if (!quiesced.success) {
        return err({
          ...quiesced.error,
          type: 'cleanup-failed',
          message: `Quiescence failed: ${quiesced.error.message}`,
        });
      }
      return err({ ...controlled.failure, quiescent: true });
    }

    const stoppedAfterSettle = controlFailure(input);
    if (stoppedAfterSettle) {
      const quiesced = await quiesceAfterStop(operationPromise);
      if (!quiesced.success) {
        return err({
          ...quiesced.error,
          type: 'cleanup-failed',
          message: `Quiescence failed: ${quiesced.error.message}`,
        });
      }
      return err({ ...stoppedAfterSettle, quiescent: true });
    }
    return controlled.value;
  }

  private async cancelAllSessions(
    sessions: readonly E2ESessionInfo[],
    authoritativeTarget: LoopSessionTarget,
    cancellationPromises: E2ECancellationRegistry
  ): Promise<
    Array<{
      session: E2ESessionInfo;
      result: Result<void, E2EGateDependencyError>;
    }>
  > {
    const launched = sessions.map((session) => ({
      session,
      result: this.cancelSession(session, authoritativeTarget, cancellationPromises),
    }));
    return Promise.all(
      launched.map(async ({ session, result }) => ({ session, result: await result }))
    );
  }

  private cancelSession(
    session: E2ESessionInfo,
    authoritativeTarget: LoopSessionTarget,
    cancellationPromises: E2ECancellationRegistry
  ): Promise<Result<void, E2EGateDependencyError>> {
    const key = JSON.stringify([
      session.attemptId,
      session.conversationId,
      session.purpose,
      session.phaseId,
      session.verificationRunId,
      session.attempt,
      copyTarget(authoritativeTarget),
    ]);
    const existing = cancellationPromises.get(key);
    if (existing) return existing;

    const promise = this.callDependency(
      'E2E session cancellation',
      () =>
        this.dependencies.session.cancelE2ESession({
          attemptId: session.attemptId,
          conversationId: session.conversationId,
          purpose: session.purpose,
          phaseId: session.phaseId,
          verificationRunId: session.verificationRunId,
          attempt: session.attempt,
          target: copyTarget(authoritativeTarget),
        }),
      stabilizePlainSuccess<{
        attemptId: string;
        conversationId: string;
        purpose: 'e2e';
        phaseId: string;
        verificationRunId: string;
        attempt: number;
        target: LoopSessionTarget;
        quiescent: true;
      }>
    ).then((cancelled) => {
      if (!cancelled.success) return cancelled;
      const value = cancelled.data;
      if (
        !value ||
        typeof value !== 'object' ||
        value.quiescent !== true ||
        value.attemptId !== session.attemptId ||
        value.conversationId !== session.conversationId ||
        value.purpose !== session.purpose ||
        value.phaseId !== session.phaseId ||
        value.verificationRunId !== session.verificationRunId ||
        value.attempt !== session.attempt ||
        !sameTarget(value.target, authoritativeTarget)
      ) {
        return err({ message: 'E2E cancellation returned invalid quiescence authority.' });
      }
      return ok(undefined);
    });
    cancellationPromises.set(key, promise);
    return promise;
  }

  private async commitProgress(
    input: NormalizedInput,
    transition: E2EProgressTransition,
    featureHead: string,
    attempt: number,
    sessionAttempts: readonly LoopSessionAttempt[]
  ): Promise<Result<void, CleanRoomE2EGateError>> {
    const expected = copyE2EDurableProgress(input.progress.current);
    const reduced = reduceE2EProgress(expected, transition);
    if (!reduced.success) {
      return err(
        this.failure(
          input,
          reduced.error.type ?? 'invalid-progress-transition',
          'progress',
          reduced.error.message,
          {
            featureHead,
            attempt,
            sessionAttempts: [...sessionAttempts],
          }
        )
      );
    }
    const committed = await this.callDependency(
      'E2E durable progress',
      () =>
        this.dependencies.progress.commit({
          loopId: input.loop.id,
          phaseId: input.phase.id,
          expected,
          transition,
        }),
      stabilizeDurableProgress
    );
    let authoritative =
      committed.success && sameE2EDurableProgress(committed.data, reduced.data)
        ? committed.data
        : undefined;
    if (!authoritative) {
      const readback = await this.callDependency(
        'E2E durable progress readback',
        () =>
          this.dependencies.progress.read({
            loopId: input.loop.id,
            phaseId: input.phase.id,
          }),
        stabilizeDurableProgress
      );
      if (readback.success && sameE2EDurableProgress(readback.data, reduced.data)) {
        authoritative = readback.data;
      } else if (readback.success && sameE2EDurableProgress(readback.data, expected)) {
        return err(
          committed.success
            ? this.failure(
                input,
                'progress-authority-invalid',
                'progress',
                'Progress persistence did not commit the requested exact transition.',
                {
                  featureHead,
                  attempt,
                  sessionAttempts: [...sessionAttempts],
                }
              )
            : this.dependencyFailure(input, committed.error, 'progress', featureHead, attempt, [
                ...sessionAttempts,
              ])
        );
      } else {
        const message = readback.success
          ? 'Progress persistence/readback returned divergent durable authority.'
          : `Progress persistence could not be reconciled: ${readback.error.message}`;
        return err(
          this.failure(input, 'progress-authority-invalid', 'progress', message, {
            featureHead,
            attempt,
            recoveryRequired: true,
            sessionAttempts: [...sessionAttempts],
          })
        );
      }
    }
    input.progress.current = copyE2EDurableProgress(authoritative);
    input.loop = { ...input.loop, state: input.progress.current.loopState };
    input.phase = { ...input.phase, state: input.progress.current.phaseState };
    return ok();
  }

  private async settleNestedAttemptAuthority(
    input: NormalizedInput,
    active: ActiveAttempt,
    featureHead: string,
    attempt: number,
    sessionAttempts: LoopSessionAttempt[],
    nestedLedgerIndex: number,
    value: unknown
  ): Promise<Result<void, CleanRoomE2EGateError>> {
    const settlement = collectNestedAttemptSettlement(
      sessionAttempts,
      nestedLedgerIndex,
      value,
      active,
      featureHead,
      input,
      safeNow(this.dependencies.now)
    );
    const actualLedgerIndices: number[] = [];
    for (const actual of settlement.actuals) {
      const {
        checkpointAfter: _checkpointAfter,
        error: _error,
        finishedAt: _finishedAt,
        status: _status,
        ...identity
      } = actual;
      actualLedgerIndices.push(
        sessionAttempts.push(
          loopSessionAttemptSchema.parse({
            ...identity,
            status: 'starting',
          })
        ) - 1
      );
    }
    if (actualLedgerIndices.length > 0) {
      const startingPersisted = await this.syncSessionProgress(
        input,
        featureHead,
        attempt,
        sessionAttempts
      );
      if (!startingPersisted.success) return startingPersisted;
    }
    sessionAttempts[nestedLedgerIndex] = settlement.expected;
    for (const [index, actualLedgerIndex] of actualLedgerIndices.entries()) {
      sessionAttempts[actualLedgerIndex] = settlement.actuals[index]!;
    }
    const terminalPersisted = await this.syncSessionProgress(
      input,
      featureHead,
      attempt,
      sessionAttempts
    );
    if (!terminalPersisted.success) return terminalPersisted;
    if (settlement.ambiguousActual) {
      return err(
        this.failure(
          input,
          'native-verifier-ledger-ambiguous',
          'required-checks',
          'Nested verification returned more than one distinct actual session identity.',
          {
            featureHead,
            attempt,
            recoveryRequired: true,
            sessionAttempts,
          }
        )
      );
    }
    return ok();
  }

  private async syncSessionProgress(
    input: NormalizedInput,
    featureHead: string,
    attempt: number,
    sessionAttempts: readonly LoopSessionAttempt[]
  ): Promise<Result<void, CleanRoomE2EGateError>> {
    const historicalCount = input.previousSessionAttempts.length;
    const desiredLength = historicalCount + sessionAttempts.length;
    const durableLength = input.progress.current.loopState.sessionAttempts.length;
    if (durableLength < historicalCount || durableLength > desiredLength) {
      return err(
        this.failure(
          input,
          'progress-authority-invalid',
          'progress',
          'Durable session progress contains an unexpected append-only suffix.',
          { featureHead, attempt, sessionAttempts: [...sessionAttempts] }
        )
      );
    }
    const desired = [
      ...input.previousSessionAttempts.map(copyAttempt),
      ...sessionAttempts.map(copyAttempt),
    ];
    if (
      JSON.stringify(input.progress.current.loopState.sessionAttempts) !== JSON.stringify(desired)
    ) {
      const committed = await this.commitProgress(
        input,
        { kind: 'session-attempts', next: desired },
        featureHead,
        attempt,
        sessionAttempts
      );
      if (!committed.success) return committed;
    }
    if (input.progress.current.loopState.sessionAttempts.length !== desiredLength) {
      return err(
        this.failure(
          input,
          'progress-authority-invalid',
          'progress',
          'Durable session progress contains an unexpected append-only suffix.',
          { featureHead, attempt, sessionAttempts: [...sessionAttempts] }
        )
      );
    }
    return ok();
  }

  private async reserveUnexpectedOuterAttempt(
    input: NormalizedInput,
    session: unknown,
    target: LoopSessionTarget,
    featureHead: string,
    attempt: number,
    startedAt: string,
    sessionAttempts: LoopSessionAttempt[]
  ): Promise<{ index?: number; error?: CleanRoomE2EGateError }> {
    const starting = tryMakeOuterAttempt(session, target, featureHead, startedAt, 'starting');
    if (!starting || !freshAttemptIdentity(starting, input, sessionAttempts)) return {};
    const index = sessionAttempts.push(starting) - 1;
    const persisted = await this.syncSessionProgress(input, featureHead, attempt, sessionAttempts);
    return persisted.success ? { index } : { index, error: persisted.error };
  }

  private async retryUnexpectedStartingProgress(
    input: NormalizedInput,
    featureHead: string,
    attempt: number,
    sessionAttempts: LoopSessionAttempt[],
    prior?: CleanRoomE2EGateError
  ): Promise<Result<void, CleanRoomE2EGateError>> {
    if (!prior) return ok();
    return this.syncSessionProgress(input, featureHead, attempt, sessionAttempts);
  }

  private commitWorkspaceProgress(
    input: NormalizedInput,
    verification: LoopVerificationWorkspaceState | null,
    featureHead: string,
    attempt: number,
    sessionAttempts: readonly LoopSessionAttempt[]
  ): Promise<Result<void, CleanRoomE2EGateError>> {
    return this.commitProgress(
      input,
      { kind: 'workspace', verification },
      featureHead,
      attempt,
      sessionAttempts
    );
  }

  private async prepareCleanupProgress(
    input: NormalizedInput,
    cleanRoom: CleanRoomWorkspace,
    featureHead: string,
    attempt: number,
    sessionAttempts: readonly LoopSessionAttempt[]
  ): Promise<Result<void, CleanRoomE2EGateError>> {
    const sessions = await this.syncSessionProgress(input, featureHead, attempt, sessionAttempts);
    if (!sessions.success) return sessions;
    return this.commitWorkspaceProgress(
      input,
      verificationProgress({
        currentVerification: input.progress.current.loopState.verification,
        verificationRunId: cleanRoom.verificationRunId,
        attempt,
        status: 'destroying',
        baseCommit: cleanRoom.baseCommit,
        featureHead,
        updatedAt: safeNow(this.dependencies.now),
        cleanRoom,
        cleanupStatus: 'running',
      }),
      featureHead,
      attempt,
      sessionAttempts
    );
  }

  private async cleanupActive(
    input: NormalizedInput,
    active: ActiveAttempt,
    featureHead: string,
    sessionAttempts: LoopSessionAttempt[]
  ): Promise<CleanupResult> {
    return this.cleanup(
      input,
      active.cleanRoom,
      active.binding,
      featureHead,
      active.number,
      sessionAttempts
    );
  }

  private async cleanup(
    input: NormalizedInput,
    cleanRoom: CleanRoomWorkspace,
    binding: E2EExecutionBinding,
    featureHead: string,
    attempt: number,
    sessionAttempts: LoopSessionAttempt[]
  ): Promise<CleanupResult> {
    const progress = await this.prepareCleanupProgress(
      input,
      cleanRoom,
      featureHead,
      attempt,
      sessionAttempts
    );
    const released = await this.callDependency(
      'E2E execution release',
      () =>
        this.dependencies.execution.release({
          target: copyTarget(binding.target),
          executionTarget: binding.executionTarget,
        }),
      stabilizePlainSuccess<{ target: LoopSessionTarget; released: true }>
    );
    if (!released.success) {
      return err(
        this.dependencyFailure(
          input,
          released.error,
          'cleanup',
          featureHead,
          attempt,
          sessionAttempts,
          {
            recoveryRequired: true,
            lastWorkspaceDestroyed: false,
            pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
          }
        )
      );
    }
    if (
      !released.data ||
      typeof released.data !== 'object' ||
      released.data.released !== true ||
      !sameTarget(released.data.target, binding.target)
    ) {
      return err(
        this.failure(
          input,
          'cleanup-failed',
          'cleanup',
          'Execution release returned invalid authority.',
          {
            featureHead,
            attempt,
            recoveryRequired: true,
            lastWorkspaceDestroyed: false,
            pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
            sessionAttempts,
          }
        )
      );
    }
    const destroyed = await this.destroyOnly(
      input,
      cleanRoom,
      featureHead,
      attempt,
      sessionAttempts,
      progress.success
    );
    if (!destroyed.success) return destroyed;
    return ok();
  }

  private async destroyOnly(
    input: NormalizedInput,
    cleanRoom: CleanRoomWorkspace,
    featureHead: string,
    attempt: number,
    sessionAttempts: LoopSessionAttempt[],
    progressPrepared = false
  ): Promise<CleanupResult> {
    let progress = progressPrepared
      ? ok(undefined)
      : await this.prepareCleanupProgress(input, cleanRoom, featureHead, attempt, sessionAttempts);
    const destroyed = await this.callDependency('Clean-room destruction', () =>
      this.dependencies.cleanRoom.destroy(cleanRoom, input.project)
    );
    if (!destroyed.success) {
      await this.commitWorkspaceProgress(
        input,
        verificationProgress({
          currentVerification: input.progress.current.loopState.verification,
          verificationRunId: cleanRoom.verificationRunId,
          attempt,
          status: 'cleanup-failed',
          baseCommit: cleanRoom.baseCommit,
          featureHead,
          updatedAt: safeNow(this.dependencies.now),
          cleanRoom,
          cleanupStatus: 'failed',
          cleanupError: destroyed.error.message,
        }),
        featureHead,
        attempt,
        sessionAttempts
      );
      return err(
        this.dependencyFailure(
          input,
          destroyed.error,
          'cleanup',
          featureHead,
          attempt,
          sessionAttempts,
          {
            recoveryRequired: true,
            lastWorkspaceDestroyed: false,
            pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
          },
          true
        )
      );
    }
    if (destroyed.data !== undefined) {
      const invalidDestruction = {
        type: 'untrusted-settlement',
        message: 'Clean-room destruction returned invalid success authority.',
      };
      await this.commitWorkspaceProgress(
        input,
        verificationProgress({
          currentVerification: input.progress.current.loopState.verification,
          verificationRunId: cleanRoom.verificationRunId,
          attempt,
          status: 'cleanup-failed',
          baseCommit: cleanRoom.baseCommit,
          featureHead,
          updatedAt: safeNow(this.dependencies.now),
          cleanRoom,
          cleanupStatus: 'failed',
          cleanupError: invalidDestruction.message,
        }),
        featureHead,
        attempt,
        sessionAttempts
      );
      return err(
        this.dependencyFailure(
          input,
          invalidDestruction,
          'cleanup',
          featureHead,
          attempt,
          sessionAttempts,
          {
            recoveryRequired: true,
            lastWorkspaceDestroyed: false,
            pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
          },
          true
        )
      );
    }
    if (!progress.success) {
      const retry = await this.prepareCleanupProgress(
        input,
        cleanRoom,
        featureHead,
        attempt,
        sessionAttempts
      );
      if (retry.success) progress = retry;
    }
    const cleared = await this.commitWorkspaceProgress(
      input,
      null,
      featureHead,
      attempt,
      sessionAttempts
    );
    if (!cleared.success) {
      return err({
        ...cleared.error,
        recoveryRequired: true,
        lastWorkspaceDestroyed: true,
      });
    }
    if (!progress.success) {
      return err({
        ...progress.error,
        recoveryRequired: true,
        lastWorkspaceDestroyed: true,
      });
    }
    return ok();
  }

  private async inspectFeatureAuthorityUncontrolled(
    input: NormalizedInput,
    cachedFeatureHead: string,
    attempt: number,
    sessionAttempts: LoopSessionAttempt[],
    verificationRunId?: string,
    conversationId?: string
  ): Promise<Result<string, CleanRoomE2EGateError>> {
    const inspected = await this.callDependency(
      'Uncontrolled feature authority',
      () =>
        this.dependencies.authority.inspectFeature({
          target: copyTarget(input.featureTarget),
          expectedFeatureHead: cachedFeatureHead,
        }),
      stabilizePlainSuccess<E2EFeatureInspection>
    );
    if (!inspected.success) {
      return err(
        this.dependencyFailure(
          input,
          inspected.error,
          'finalize',
          cachedFeatureHead,
          attempt,
          sessionAttempts,
          {
            ...(verificationRunId ? { verificationRunId } : {}),
            ...(conversationId ? { conversationId } : {}),
            recoveryRequired: true,
            lastWorkspaceDestroyed: true,
          }
        )
      );
    }
    if (
      !inspected.data ||
      typeof inspected.data !== 'object' ||
      !sameTarget(inspected.data.target, input.featureTarget) ||
      !validCommit(inspected.data.headCommit) ||
      inspected.data.clean !== true ||
      inspected.data.branchAttached !== true
    ) {
      return err(
        this.failure(
          input,
          'feature-authority-invalid',
          'finalize',
          'Feature authority could not attest an exact clean attached HEAD after cleanup.',
          {
            featureHead: cachedFeatureHead,
            attempt,
            ...(verificationRunId ? { verificationRunId } : {}),
            ...(conversationId ? { conversationId } : {}),
            recoveryRequired: true,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          }
        )
      );
    }
    return ok(inspected.data.headCommit);
  }

  private dependencyFailure(
    input: RunCleanRoomE2EGateInput,
    dependencyError: E2EGateDependencyError,
    stage: CleanRoomE2EGateStage,
    featureHead: string,
    attempt: number,
    sessionAttempts: LoopSessionAttempt[],
    extra: Partial<CleanRoomE2EGateError> = {},
    allowPendingCleanup = false
  ): CleanRoomE2EGateError {
    const type =
      stage === 'cleanup' || dependencyError.type === 'cleanup-failed'
        ? 'cleanup-failed'
        : dependencyError.type === 'cancelled' || dependencyError.kind === 'cancelled'
          ? 'cancelled'
          : dependencyError.type === 'deadline-exceeded' ||
              dependencyError.kind === 'deadline-exceeded'
            ? 'deadline-exceeded'
            : 'dependency-rejected';
    const pendingCleanup = allowPendingCleanup
      ? safePendingCleanup(dependencyError.pendingCleanup, input, stage, extra.pendingWorkspace)
      : undefined;
    return this.failure(input, type, stage, dependencyError.message, {
      featureHead,
      attempt,
      sessionAttempts,
      ...(pendingCleanup ? { pendingCleanup } : {}),
      ...extra,
    });
  }

  private failure(
    input: { intermediateFailures?: unknown },
    type: string,
    stage: CleanRoomE2EGateStage,
    message: string,
    fields: Pick<CleanRoomE2EGateError, 'featureHead' | 'attempt' | 'sessionAttempts'> &
      Partial<CleanRoomE2EGateError>
  ): CleanRoomE2EGateError {
    const status =
      type === 'cancelled' ? 'cancelled' : type === 'deadline-exceeded' ? 'interrupted' : 'failed';
    return {
      type,
      stage,
      message: boundedSummary(message, 'Clean-room E2E failed.'),
      featureHead: fields.featureHead,
      attempt: fields.attempt,
      ...(fields.verificationRunId ? { verificationRunId: fields.verificationRunId } : {}),
      ...(fields.conversationId ? { conversationId: fields.conversationId } : {}),
      ...(fields.recoveryRequired !== undefined
        ? { recoveryRequired: fields.recoveryRequired }
        : {}),
      ...(fields.pendingCleanup !== undefined ? { pendingCleanup: fields.pendingCleanup } : {}),
      ...(fields.pendingWorkspace !== undefined
        ? { pendingWorkspace: clonePendingWorkspace(fields.pendingWorkspace) }
        : {}),
      ...(fields.lastWorkspaceDestroyed !== undefined
        ? { lastWorkspaceDestroyed: fields.lastWorkspaceDestroyed }
        : {}),
      sessionAttempts: fields.sessionAttempts.map(copyAttempt),
      intermediateFailures: safeCopyPromptHandoffs(input.intermediateFailures),
      stageResult: this.stageResult(
        status,
        status === 'cancelled'
          ? 'Clean-room E2E was cancelled.'
          : status === 'interrupted'
            ? 'Clean-room E2E exceeded its deadline.'
            : message
      ),
    };
  }

  private stageResult(
    status: 'passed' | 'failed' | 'cancelled' | 'interrupted',
    summary: string
  ): LoopStageResult {
    return loopStageResultSchema.parse({
      status,
      summary: boundedSummary(summary, 'Clean-room E2E completed.'),
      completedAt: safeNow(this.dependencies.now),
    });
  }
}

function monotonicTerminalStageResult(
  result: LoopStageResult,
  attempts: readonly LoopSessionAttempt[],
  progress: E2EDurableProgress,
  terminalHandoff: LoopPhaseHandoff | null
): LoopStageResult {
  const timestamps: Array<string | undefined> = [result.completedAt];
  for (const attempt of progress.loopState.sessionAttempts) {
    timestamps.push(attempt.startedAt, attempt.finishedAt);
  }
  for (const attempt of attempts) timestamps.push(attempt.startedAt, attempt.finishedAt);
  const addHandoff = (handoff: LoopPhaseHandoff | null | undefined): void => {
    if (!handoff) return;
    timestamps.push(handoff.createdAt);
    for (const artifact of handoff.artifacts) timestamps.push(artifact.createdAt);
  };
  addHandoff(progress.phaseState?.handoff);
  for (const retry of progress.phaseState?.retryHandoffs ?? []) addHandoff(retry.handoff);
  addHandoff(terminalHandoff);
  return loopStageResultSchema.parse({
    ...result,
    completedAt: monotonicTimestamp(...timestamps),
  });
}

function monotonicCorrectionHandoffTimestamp(
  input: NormalizedInput,
  attempts: readonly LoopSessionAttempt[],
  intermediateFailures: readonly LoopPromptHandoff[],
  currentTimestamp: string
): string {
  const timestamps: Array<string | undefined> = [currentTimestamp];
  for (const attempt of input.previousSessionAttempts) {
    timestamps.push(attempt.startedAt, attempt.finishedAt);
  }
  for (const attempt of attempts) timestamps.push(attempt.startedAt, attempt.finishedAt);

  const addHandoff = (handoff: LoopPhaseHandoff | null | undefined): void => {
    if (!handoff) return;
    timestamps.push(handoff.createdAt);
    for (const artifact of handoff.artifacts) timestamps.push(artifact.createdAt);
  };
  for (const prior of input.handoffs) addHandoff(prior.handoff);
  for (const prior of intermediateFailures) addHandoff(prior.handoff);
  addHandoff(input.progress.current.phaseState?.handoff);
  for (const retry of input.progress.current.phaseState?.retryHandoffs ?? []) {
    addHandoff(retry.handoff);
  }
  return monotonicTimestamp(...timestamps);
}

function preflightAggregateE2EPrompt(input: NormalizedInput): string | undefined {
  const worstCaseTarget: LoopSessionTarget = {
    workspaceId: '<'.repeat(MAX_ID_LENGTH),
    path: `/${'<'.repeat(4_095)}`,
    machine:
      input.featureTarget.machine.kind === 'local'
        ? { kind: 'local' }
        : { kind: 'ssh', connectionId: '<'.repeat(MAX_ID_LENGTH) },
  };
  try {
    buildE2EPrompt({
      goal: input.goal,
      acceptanceCriteria: [...input.acceptanceCriteria],
      baseCommit: input.baseCommit,
      checkpointCommit: input.checkpointCommit,
      handoffs: [...input.handoffs],
      verificationRunId: '<'.repeat(MAX_ID_LENGTH),
      verificationTarget: worstCaseTarget,
      attempt: CLEAN_ROOM_E2E_MAX_ATTEMPTS,
      intermediateFailures: [...input.intermediateFailures],
    });
    return undefined;
  } catch {
    return 'Aggregate E2E prompt data exceeds the bounded pre-execution contract.';
  }
}

function validateBinding(
  binding: E2EExecutionBinding,
  target: LoopSessionTarget,
  input: NormalizedInput,
  effectiveDefaultBranch: string
): { type: string; message: string; safeToRelease: boolean } | undefined {
  if (
    !binding ||
    typeof binding !== 'object' ||
    !binding.executionTarget ||
    typeof binding.executionTarget !== 'object' ||
    typeof binding.executionTarget.dispose !== 'function' ||
    !binding.executionTarget.executionContext ||
    typeof binding.executionTarget.executionContext !== 'object' ||
    !sameTarget(binding.target, target) ||
    !sameExecutionTargetIdentity(binding.executionTarget, target)
  ) {
    return {
      type: 'execution-target-drift',
      message: 'Execution binding drifted from the clean room.',
      safeToRelease: false,
    };
  }
  if (
    !trustedTaskEnvironmentSchema.safeParse(binding.taskEnvironment).success ||
    !trustedTaskEnvironmentSchema.safeParse(binding.executionTarget.taskEnv).success ||
    !sameEnvironment(binding.executionTarget.taskEnv, binding.taskEnvironment)
  ) {
    return {
      type: 'task-environment-invalid',
      message: 'Execution binding returned a malformed or mismatched task environment.',
      safeToRelease: true,
    };
  }
  const keys = Object.keys(binding.taskEnvironment).sort();
  const values = Object.values(binding.taskEnvironment);
  const valuesAreBoundedStrings = values.every(
    (value) => typeof value === 'string' && value.length <= MAX_TASK_ENVIRONMENT_VALUE_LENGTH
  );
  const environmentBytes = valuesAreBoundedStrings
    ? keys.reduce(
        (total, key) =>
          total +
          Buffer.byteLength(key, 'utf8') +
          Buffer.byteLength(binding.taskEnvironment[key] ?? '', 'utf8'),
        0
      )
    : Number.POSITIVE_INFINITY;
  const expectedEnvironment = getTaskEnvVars({
    taskId: input.task.id,
    taskName: input.task.name,
    taskPath: target.path,
    projectPath: input.project.repoPath,
    defaultBranch: effectiveDefaultBranch,
    portSeed: target.path,
  });
  if (
    keys.length !== TRUSTED_TASK_ENVIRONMENT_KEYS.length ||
    TRUSTED_TASK_ENVIRONMENT_KEYS.some((key) => !keys.includes(key)) ||
    !valuesAreBoundedStrings ||
    environmentBytes > MAX_TASK_ENVIRONMENT_BYTES ||
    !sameEnvironment(binding.taskEnvironment, expectedEnvironment) ||
    !sameEnvironment(binding.executionTarget.taskEnv, expectedEnvironment)
  ) {
    return {
      type: 'task-environment-invalid',
      message: 'Trusted task environment is not the exact six-key overlay.',
      safeToRelease: true,
    };
  }
  return undefined;
}

function validateSession(
  session: E2ESessionInfo,
  target: LoopSessionTarget,
  taskEnvironment: Readonly<Record<string, string>>,
  input: NormalizedInput,
  verificationRunId: string,
  attempt: number,
  attempts: readonly LoopSessionAttempt[],
  expectedIdentity: { attemptId: string; conversationId: string }
): { type: string; message: string } | undefined {
  if (!e2eSessionInfoSchema.safeParse(session).success) {
    return {
      type: 'session-authority-invalid',
      message: 'Fresh E2E session returned malformed or unbounded authority.',
    };
  }
  if (!validId(session.attemptId) || !validId(session.conversationId)) {
    return { type: 'session-authority-invalid', message: 'Fresh E2E session IDs are invalid.' };
  }
  if (
    session.attemptId !== expectedIdentity.attemptId ||
    session.conversationId !== expectedIdentity.conversationId
  ) {
    const reused = [...input.previousSessionAttempts, ...attempts].some(
      (item) =>
        item.attemptId === session.attemptId || item.conversationId === session.conversationId
    );
    return reused
      ? { type: 'stale-conversation', message: 'Fresh E2E session reused prior identity.' }
      : {
          type: 'session-authority-invalid',
          message: 'Fresh E2E session ignored its preallocated durable identity.',
        };
  }
  if (
    session.purpose !== 'e2e' ||
    session.phaseId !== input.phase.id ||
    session.verificationRunId !== verificationRunId ||
    session.attempt !== attempt ||
    session.provider !== input.provider ||
    session.model !== input.model ||
    !sameTarget(session.target, target) ||
    !sameEnvironment(session.taskEnvironment, taskEnvironment)
  ) {
    return { type: 'session-authority-invalid', message: 'Fresh E2E session attestation drifted.' };
  }
  return undefined;
}

function validatePromptResult(
  value: {
    attemptId: string;
    conversationId: string;
    purpose: 'e2e';
    phaseId: string;
    verificationRunId: string;
    attempt: number;
    target: LoopSessionTarget;
    finalText: string;
  },
  session: E2ESessionInfo
): { type: string; message: string } | undefined {
  if (!e2ePromptResultSchema.safeParse(value).success) {
    return {
      type: 'prompt-authority-invalid',
      message: 'E2E prompt returned malformed or unbounded authority.',
    };
  }
  if (
    value.attemptId !== session.attemptId ||
    value.conversationId !== session.conversationId ||
    value.purpose !== session.purpose ||
    value.phaseId !== session.phaseId ||
    value.verificationRunId !== session.verificationRunId ||
    value.attempt !== session.attempt ||
    !sameTarget(value.target, session.target) ||
    typeof value.finalText !== 'string'
  ) {
    return { type: 'prompt-authority-invalid', message: 'E2E prompt returned invalid authority.' };
  }
  return undefined;
}

function validateRequiredChecks(
  checks: E2ERequiredChecksResult,
  active: ActiveAttempt,
  featureHead: string,
  input: NormalizedInput,
  existingAttempts: readonly LoopSessionAttempt[],
  preallocatedAttempt: LoopSessionAttempt
): { type: string; message: string } | undefined {
  if (
    checks &&
    typeof checks === 'object' &&
    checks.status === 'correctable' &&
    (!checks.handoff || !tryCopyPromptHandoff(checks.handoff))
  ) {
    return {
      type: 'unsafe-correction-handoff',
      message: 'Correctable checks require one bounded safe handoff.',
    };
  }
  if (!e2eRequiredChecksResultSchema.safeParse(checks).success) {
    return {
      type: 'required-checks-authority-invalid',
      message: 'Required checks returned malformed or unbounded authority.',
    };
  }
  if (
    !['passed', 'correctable', 'failed'].includes(checks.status) ||
    checks.loopId !== input.loop.id ||
    checks.phaseId !== input.phase.id ||
    checks.fullChecksRan !== true ||
    checks.verificationRunId !== active.verificationRunId ||
    checks.attempt !== active.number ||
    checks.outerConversationId !== active.session.conversationId ||
    !sameTarget(checks.target, active.cleanRoom.target) ||
    !sameTarget(checks.executionTarget, active.cleanRoom.target) ||
    checks.checkpointCommit !== featureHead ||
    checks.provider !== input.provider ||
    checks.model !== input.model ||
    !sameStringArray(checks.validationCommands, input.validationCommands) ||
    !sameCriteria(checks.criteria, input.criteria) ||
    !sameEnvironment(checks.taskEnvironment, active.binding.taskEnvironment)
  ) {
    return {
      type: 'required-checks-authority-invalid',
      message: 'Required checks returned stale or drifted authority.',
    };
  }
  if (
    checks.nativeBrowserRan !== true ||
    checks.nativePreview.invocationCount !== 1 ||
    !sameTarget(checks.nativePreview.target, active.cleanRoom.target) ||
    checks.nativePreview.provider !== input.provider ||
    checks.nativePreview.model !== input.model ||
    !sameEnvironment(checks.nativePreview.taskEnvironment, active.binding.taskEnvironment) ||
    checks.nativeEvidence.runId !== active.verificationRunId
  ) {
    return {
      type: 'native-verifier-authority-invalid',
      message: 'Exactly one target-bound native verifier invocation is required.',
    };
  }
  if (
    checks.nativeEvidence.artifacts.some(
      (artifact) =>
        artifact.kind === 'screenshot' &&
        artifact.mimeType !== 'image/png' &&
        artifact.mimeType !== 'image/jpeg'
    )
  ) {
    return {
      type: 'native-verifier-authority-invalid',
      message: 'Native screenshot evidence requires exact PNG or JPEG MIME authority.',
    };
  }
  if (checks.status === 'passed' && !checks.nativePreview.passed) {
    return { type: 'native-verifier-failed', message: 'Native preview did not pass.' };
  }
  if (checks.status === 'correctable') {
    if (!checks.handoff || !tryCopyPromptHandoff(checks.handoff)) {
      return {
        type: 'unsafe-correction-handoff',
        message: 'Correctable checks require one bounded safe handoff.',
      };
    }
  } else if (checks.handoff !== undefined) {
    return {
      type: 'unsafe-correction-handoff',
      message: 'Only correctable checks may return a handoff.',
    };
  }
  if (checks.sessionAttempts.length !== 1) {
    return {
      type: 'native-verifier-ledger-invalid',
      message: 'Native verifier must attest exactly one nested browser session.',
    };
  }
  for (const candidate of checks.sessionAttempts) {
    const parsed = loopSessionAttemptSchema.safeParse(candidate);
    if (
      !parsed.success ||
      !hasCanonicalAttemptFields(candidate, parsed.data) ||
      parsed.data.attemptId !== preallocatedAttempt.attemptId ||
      parsed.data.conversationId !== preallocatedAttempt.conversationId ||
      parsed.data.purpose !== 'browser-verification' ||
      parsed.data.status !== 'completed' ||
      parsed.data.finishedAt === undefined ||
      parsed.data.phaseId !== input.phase.id ||
      parsed.data.verificationRunId !== active.verificationRunId ||
      parsed.data.checkpointBefore !== featureHead ||
      parsed.data.checkpointAfter !== featureHead ||
      !hasCanonicalAttemptTarget(candidate, active.cleanRoom.target) ||
      parsed.data.conversationId === active.session.conversationId ||
      input.previousSessionAttempts.some(
        (attempt) =>
          attempt.attemptId === parsed.data.attemptId ||
          attempt.conversationId === parsed.data.conversationId
      ) ||
      existingAttempts.some(
        (attempt) =>
          attempt !== preallocatedAttempt &&
          (attempt.attemptId === parsed.data.attemptId ||
            attempt.conversationId === parsed.data.conversationId)
      )
    ) {
      return {
        type: 'native-verifier-ledger-invalid',
        message: 'Native verifier ledger is not fresh and target-bound.',
      };
    }
  }
  return undefined;
}
