import { Buffer } from 'node:buffer';
import { redactAll } from '@emdash/shared/logger';
import z from 'zod';
import { err, ok, type Result } from '@main/lib/result';
import {
  loopPhaseStateInputSchema,
  loopStageResultSchema,
  type LoopStageResult,
} from '@shared/core/loops/loop-phase-state';
import {
  loopCommitSchema,
  loopSessionAttemptSchema,
  loopSessionTargetSchema,
  loopStateV1Schema,
  type LoopSessionAttempt,
  type LoopSessionTarget,
  type LoopVerificationWorkspaceState,
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
  type LoopProviderId,
  type LoopTerminalGates,
} from '@shared/core/loops/loops';
import type {
  CleanRoomProject,
  CleanRoomWorkspace,
} from '../clean-room/clean-room-workspace-service';
import {
  clonePendingCleanup,
  parseCleanRoomPendingCleanup,
  type CleanRoomPendingCleanup,
} from '../clean-room/cleanup-journal';
import { buildE2EPrompt, parseE2ESentinel } from '../e2e-prompt';
import {
  loopPromptContextInputSchema,
  loopPromptHandoffSchema,
  type LoopPromptContextInput,
  type LoopPromptHandoff,
} from '../handoff-builder';
import type { LoopExecutionTarget } from '../runtime/loop-execution-target';
import {
  copyE2EDurableProgress,
  reduceE2EProgress,
  sameE2EDurableProgress,
  type E2EDurableProgress,
  type E2EProgressPort,
  type E2EProgressTransition,
} from './clean-room-e2e-progress';

const MAX_ATTEMPTS = 64;
const MAX_ID_LENGTH = 256;
const MAX_MODEL_LENGTH = 256;
const MAX_SUMMARY_LENGTH = 16_384;
const MAX_TASK_ENVIRONMENT_BYTES = 64 * 1024;
const MAX_TASK_ENVIRONMENT_VALUE_LENGTH = 4_096;
const MAX_VALIDATION_COMMANDS = 64;
const MAX_VALIDATION_COMMAND_LENGTH = 4_096;
const MAX_SESSION_ATTEMPTS = 1_024;
const MAX_STABLE_SUCCESS_BYTES = 2 * 1024 * 1024;
const MAX_SESSION_RECORDS_PER_E2E_ATTEMPT = 3;
const cookieAssignmentPattern =
  /\b(?:cookies?|set[_ -]?cookie|session[_ -]?(?:cookie|id)|sessionid)\b[\\'"\s]*[:=][\s\S]*/giu;
const TRUSTED_TASK_ENVIRONMENT_KEYS = [
  'EMDASH_DEFAULT_BRANCH',
  'EMDASH_PORT',
  'EMDASH_ROOT_PATH',
  'EMDASH_TASK_ID',
  'EMDASH_TASK_NAME',
  'EMDASH_TASK_PATH',
] as const;
const trustedTaskEnvironmentSchema = z.record(z.string(), z.string());
const validationCommandsSchema = z
  .array(z.string().trim().min(1).max(MAX_VALIDATION_COMMAND_LENGTH))
  .min(1)
  .max(MAX_VALIDATION_COMMANDS);
const e2eCriteriaSchema = z
  .array(loopPhaseCriterionSchema)
  .min(1)
  .max(64)
  .refine(
    (criteria) => criteria.some((criterion) => criterion.verifier === 'agent-browser'),
    'E2E criteria must include native browser verification'
  );
const e2eLoopConfigSchema = newLoopConfigV2Schema.strict();
const e2ePhaseCriteriaSchema = loopPhaseCriteriaV1Schema.strict();
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
    sessionAttempts: z.array(loopSessionAttemptSchema).max(1_024),
    handoff: loopPromptHandoffSchema.optional(),
  })
  .strict();

export type E2EGateDependencyError = {
  type?: string;
  kind?: string;
  message: string;
  pendingCleanup?: unknown;
};

export type E2ERequiredChecksError = E2EGateDependencyError & {
  sessionAttempts?: unknown;
};

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
  workPhaseResults: readonly LoopStageResult[];
  reviewStageResult?: LoopStageResult;
  intermediateFailures: readonly LoopPromptHandoff[];
  maxAttempts: number;
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

type NormalizedInput = RunCleanRoomE2EGateInput & {
  featureTarget: LoopSessionTarget;
  validationCommands: string[];
  criteria: LoopPhaseCriterion[];
  previousSessionAttempts: LoopSessionAttempt[];
  progress: { current: E2EDurableProgress };
};

type ActiveAttempt = {
  number: number;
  verificationRunId: string;
  cleanRoom: CleanRoomWorkspace;
  binding: E2EExecutionBinding;
  authority: E2EAttemptAuthority;
  session: E2ESessionInfo;
  outerLedgerIndex: number;
};

type CleanupResult = Result<void, CleanRoomE2EGateError>;

type ControlFailure = {
  type: 'cancelled' | 'deadline-exceeded';
  message: string;
};

type ControlledDependencyOutcome<T> =
  | { kind: 'completed'; value: Result<T, E2EGateDependencyError> }
  | { kind: 'stopped'; failure: ControlFailure };

type StopQuiescence<T> = (
  operation: Promise<Extract<ControlledDependencyOutcome<T>, { kind: 'completed' }>>
) => Promise<Result<void, E2EGateDependencyError>>;

type CancellationRegistry = Map<string, Promise<Result<void, E2EGateDependencyError>>>;
type SuccessStabilizer<T> = (value: unknown) => T | undefined;
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
        this.failure(rawInput, normalized.error.type, 'precondition', normalized.error.message, {
          featureHead: validCommit(rawInput.checkpointCommit) ? rawInput.checkpointCommit : '',
          attempt: 0,
          sessionAttempts: [],
        })
      );
    }
    let input = normalized.data;
    lifecycle.input = input;
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

    let featureHead = input.checkpointCommit;
    let correctionCount = 0;
    const intermediateFailures = [...input.intermediateFailures];
    const sessionAttempts: LoopSessionAttempt[] = [];
    const verificationRunIds: string[] = [];
    const cancellationPromises: CancellationRegistry = new Map();

    for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
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
          created.error.type === 'untrusted-settlement' ||
          created.error.type === 'cleanup-failed' ||
          pendingCleanup !== undefined;
        const createProgress = await this.commitWorkspaceProgress(
          input,
          recoveryRequired
            ? verificationProgress({
                verificationRunId,
                attempt,
                status: 'cleanup-failed',
                baseCommit: input.baseCommit,
                featureHead,
                updatedAt: safeNow(this.dependencies.now),
                cleanupStatus: 'failed',
                cleanupError: created.error.message,
              })
            : null,
          featureHead,
          attempt,
          sessionAttempts
        );
        if (!createProgress.success && !recoveryRequired) return createProgress;
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
                : {}),
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
        if (!destroyed.success && destroyed.error.type === 'cleanup-failed') return destroyed;
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
        if (acquired.error.type === 'untrusted-settlement') {
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
      const bindingError = validateBinding(binding, cleanRoom.target, input);
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

      let sessionIdentity: { attemptId: string; conversationId: string };
      try {
        const allocated = this.dependencies.createSessionIdentity({
          purpose: 'e2e',
          verificationRunId,
          attempt,
        });
        const stable = stabilizePlainSuccess<{
          attemptId: string;
          conversationId: string;
        }>(allocated);
        if (!stable) throw new TypeError('Invalid E2E session identity');
        sessionIdentity = stable;
      } catch (cause) {
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
            'dependency-rejected',
            'session-start',
            `E2E session identity allocation failed: ${errorMessage(cause)}`,
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
      const startedAt = safeNow(this.dependencies.now);
      const startingAttempt = loopSessionAttemptSchema.safeParse({
        ...sessionIdentity,
        purpose: 'e2e',
        phaseId: input.phase.id,
        verificationRunId,
        target: copyTarget(cleanRoom.target),
        status: 'starting',
        checkpointBefore: featureHead,
        startedAt,
      });
      if (
        !startingAttempt.success ||
        !validId(sessionIdentity.attemptId) ||
        !validId(sessionIdentity.conversationId) ||
        !freshAttemptIdentity(startingAttempt.data, input, sessionAttempts)
      ) {
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
            'invalid-session-identity',
            'session-start',
            'Allocated E2E session identities were invalid or already durable.',
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
      const preallocatedLedgerIndex = sessionAttempts.push(startingAttempt.data) - 1;
      const startingProgress = await this.syncSessionProgress(
        input,
        featureHead,
        attempt,
        sessionAttempts
      );
      const runningWorkspaceProgress = startingProgress.success
        ? await this.commitWorkspaceProgress(
            input,
            verificationProgress({
              verificationRunId,
              attempt,
              status: 'running',
              baseCommit: input.baseCommit,
              featureHead,
              updatedAt: safeNow(this.dependencies.now),
              cleanRoom,
            }),
            featureHead,
            attempt,
            sessionAttempts
          )
        : startingProgress;
      if (!runningWorkspaceProgress.success) {
        markOuterAttempt(
          sessionAttempts,
          preallocatedLedgerIndex,
          'interrupted',
          safeDate(this.dependencies.now),
          { error: runningWorkspaceProgress.error.message }
        );
        const cleanup = await this.cleanup(
          input,
          cleanRoom,
          binding,
          featureHead,
          attempt,
          sessionAttempts
        );
        if (!cleanup.success && cleanup.error.type === 'cleanup-failed') return cleanup;
        return runningWorkspaceProgress;
      }
      const expectedSession: E2ESessionInfo = {
        attemptId: sessionIdentity.attemptId,
        conversationId: sessionIdentity.conversationId,
        purpose: 'e2e',
        phaseId: input.phase.id,
        verificationRunId,
        attempt,
        target: copyTarget(cleanRoom.target),
        provider: input.provider,
        model: input.model,
        taskEnvironment: copyEnvironment(binding.taskEnvironment),
      };
      let stoppedSession: E2ESessionInfo | undefined;
      const started = await this.callControlled(
        input,
        'Fresh E2E session start',
        () =>
          this.dependencies.session.startFreshE2ESession({
            attemptId: sessionIdentity.attemptId,
            conversationId: sessionIdentity.conversationId,
            purpose: 'e2e',
            phaseId: input.phase.id,
            verificationRunId,
            attempt,
            target: copyTarget(cleanRoom.target),
            executionTarget: binding.executionTarget,
            taskEnvironment: copyEnvironment(binding.taskEnvironment),
            provider: input.provider,
            model: input.model,
            signal: input.signal,
            deadlineAt: input.deadlineAt,
          }),
        async (operation) => {
          const settled = await operation;
          const identities = [expectedSession];
          if (settled.value.success) {
            stoppedSession = settled.value.data;
            if (
              hasUsableCancellationIdentity(stoppedSession) &&
              !sameSessionIdentity(stoppedSession, expectedSession)
            ) {
              identities.push(stoppedSession);
            }
          }
          for (const identity of identities) {
            const cancelled = await this.cancelSession(
              identity,
              cleanRoom.target,
              cancellationPromises
            );
            if (!cancelled.success) {
              markOuterAttempt(
                sessionAttempts,
                preallocatedLedgerIndex,
                'interrupted',
                safeDate(this.dependencies.now),
                { error: cancelled.error.message }
              );
              return cancelled;
            }
          }
          markOuterAttempt(
            sessionAttempts,
            preallocatedLedgerIndex,
            'cancelled',
            safeDate(this.dependencies.now),
            { error: 'E2E session was cancelled.' }
          );
          return ok();
        },
        stabilizePlainSuccess<E2ESessionInfo>
      );
      if (!started.success) {
        markOuterAttempt(
          sessionAttempts,
          preallocatedLedgerIndex,
          started.error.type === 'cancelled'
            ? 'cancelled'
            : started.error.type === 'deadline-exceeded'
              ? 'interrupted'
              : 'failed',
          safeDate(this.dependencies.now),
          { error: started.error.message }
        );
        if (
          started.error.type === 'cleanup-failed' ||
          started.error.type === 'untrusted-settlement'
        ) {
          return err(
            this.dependencyFailure(
              input,
              started.error,
              'quiescence',
              featureHead,
              attempt,
              sessionAttempts,
              {
                verificationRunId,
                ...(stoppedSession ? { conversationId: stoppedSession.conversationId } : {}),
                recoveryRequired: true,
                lastWorkspaceDestroyed: false,
                pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
              }
            )
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
          this.dependencyFailure(
            input,
            started.error,
            'session-start',
            featureHead,
            attempt,
            sessionAttempts,
            {
              verificationRunId,
              ...(stoppedSession ? { conversationId: stoppedSession.conversationId } : {}),
              lastWorkspaceDestroyed: true,
            }
          )
        );
      }
      const session = started.data;
      const sessionError = validateSession(
        session,
        cleanRoom.target,
        binding.taskEnvironment,
        input,
        verificationRunId,
        attempt,
        sessionAttempts,
        sessionIdentity
      );
      const outerAttempt = tryMakeOuterAttempt(session, cleanRoom.target, featureHead, startedAt);
      if (!outerAttempt) {
        if (!hasUsableCancellationIdentity(session)) {
          return err(
            this.failure(
              input,
              'session-authority-invalid',
              'quiescence',
              'Fresh E2E session returned no usable cancellation identity.',
              {
                featureHead,
                attempt,
                verificationRunId,
                recoveryRequired: true,
                lastWorkspaceDestroyed: false,
                pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
                sessionAttempts,
              }
            )
          );
        }
        const cancelled = await this.cancelSession(session, cleanRoom.target, cancellationPromises);
        if (!cancelled.success) {
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
                recoveryRequired: true,
                lastWorkspaceDestroyed: false,
                pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
              }
            )
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
          this.failure(
            input,
            'session-authority-invalid',
            'session-start',
            'Fresh E2E session identity cannot be represented in the durable ledger.',
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
      const outerLedgerIndex = preallocatedLedgerIndex;
      if (!sessionError) sessionAttempts[preallocatedLedgerIndex] = outerAttempt;
      if (sessionError) {
        const returnedDifferentIdentity = !sameSessionIdentity(session, expectedSession);
        const actualLedgerIndex =
          returnedDifferentIdentity && freshAttemptIdentity(outerAttempt, input, sessionAttempts)
            ? sessionAttempts.push(outerAttempt) - 1
            : undefined;
        const cancelled = await this.cancelSession(session, cleanRoom.target, cancellationPromises);
        if (!cancelled.success) {
          markOuterAttempt(
            sessionAttempts,
            outerLedgerIndex,
            'interrupted',
            safeDate(this.dependencies.now),
            { error: 'Invalid E2E session did not prove quiescence.' }
          );
          if (actualLedgerIndex !== undefined) {
            markOuterAttempt(
              sessionAttempts,
              actualLedgerIndex,
              'interrupted',
              safeDate(this.dependencies.now),
              { error: cancelled.error.message }
            );
          }
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
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'failed',
          safeDate(this.dependencies.now),
          {
            error: sessionError.message,
          }
        );
        if (actualLedgerIndex !== undefined) {
          markOuterAttempt(
            sessionAttempts,
            actualLedgerIndex,
            'cancelled',
            safeDate(this.dependencies.now),
            { error: sessionError.message }
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
          this.failure(input, sessionError.type, 'session-start', sessionError.message, {
            featureHead,
            attempt,
            verificationRunId,
            conversationId: session.conversationId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }

      const active: ActiveAttempt = {
        number: attempt,
        verificationRunId,
        cleanRoom,
        binding,
        authority: begun.data,
        session,
        outerLedgerIndex,
      };

      const sessionProgress = await this.syncSessionProgress(
        input,
        featureHead,
        attempt,
        sessionAttempts
      );
      const runningProgress = sessionProgress.success
        ? await this.commitWorkspaceProgress(
            input,
            verificationProgress({
              verificationRunId,
              attempt,
              status: 'running',
              baseCommit: input.baseCommit,
              featureHead,
              updatedAt: safeNow(this.dependencies.now),
              cleanRoom,
            }),
            featureHead,
            attempt,
            sessionAttempts
          )
        : sessionProgress;
      if (!runningProgress.success) {
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
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'cancelled',
          safeDate(this.dependencies.now),
          { error: runningProgress.error.message }
        );
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success && cleanup.error.type === 'cleanup-failed') return cleanup;
        return runningProgress;
      }

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
        const previousFeatureHead = featureHead;
        const integratingProgress = await this.commitWorkspaceProgress(
          input,
          verificationProgress({
            verificationRunId,
            attempt,
            status: 'integrating-fix',
            baseCommit: input.baseCommit,
            featureHead,
            updatedAt: safeNow(this.dependencies.now),
            cleanRoom,
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
          if (!cleanup.success && cleanup.error.type === 'cleanup-failed') return cleanup;
          return integratingProgress;
        }
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
        intermediateFailures.push(
          copyPromptHandoff({
            source: 'Clean-room E2E correction',
            handoff: {
              summary: sentinel.summary,
              risks: ['The integrated correction still requires a fresh clean-room replay.'],
              remainingWork: [
                'Recreate the clean room and independently re-run every required check.',
              ],
              artifacts: [],
              createdAt: safeNow(this.dependencies.now),
            },
          })
        );
        input = { ...input, intermediateFailures: [...intermediateFailures] };
        lifecycle.input = input;
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
          if (!cleanup.success && cleanup.error.type === 'cleanup-failed') return cleanup;
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
        if (attempt === input.maxAttempts) {
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
        if (!cleanup.success && cleanup.error.type === 'cleanup-failed') return cleanup;
        return nestedStartingProgress;
      }

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
          await operation;
          return ok();
        },
        stabilizePlainSuccess<E2ERequiredChecksResult>
      );
      if (!checked.success) {
        settlePreallocatedNestedAttempt(
          sessionAttempts,
          nestedLedgerIndex,
          checked.error,
          active,
          featureHead,
          input,
          safeNow(this.dependencies.now)
        );
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'failed',
          safeDate(this.dependencies.now),
          {
            error: checked.error.message,
          }
        );
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
        settlePreallocatedNestedAttempt(
          sessionAttempts,
          nestedLedgerIndex,
          checked.data,
          active,
          featureHead,
          input,
          safeNow(this.dependencies.now)
        );
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'failed',
          safeDate(this.dependencies.now),
          {
            error: checksError.message,
          }
        );
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
      settlePreallocatedNestedAttempt(
        sessionAttempts,
        nestedLedgerIndex,
        checked.data,
        active,
        featureHead,
        input,
        safeNow(this.dependencies.now)
      );
      const nestedTerminalProgress = await this.syncSessionProgress(
        input,
        featureHead,
        attempt,
        sessionAttempts
      );
      if (!nestedTerminalProgress.success) {
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'interrupted',
          safeDate(this.dependencies.now),
          { error: nestedTerminalProgress.error.message }
        );
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success && cleanup.error.type === 'cleanup-failed') return cleanup;
        return nestedTerminalProgress;
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
          if (!cleanup.success && cleanup.error.type === 'cleanup-failed') return cleanup;
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
        if (attempt === input.maxAttempts) {
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
        attempt: input.maxAttempts,
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
    const terminalFeatureHead =
      result.error.type === 'feature-head-drift' ? result.error.featureHead : reconciled.data;
    return err({
      ...result.error,
      featureHead: terminalFeatureHead,
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
    const committed = await this.commitProgress(
      input,
      {
        kind: 'terminal',
        checkpointCommit: featureHead,
        handoff: intermediateFailures.at(-1)?.handoff ?? null,
        result: result.success ? result.data.stageResult : result.error.stageResult,
      },
      featureHead,
      result.success ? result.data.attempts : result.error.attempt,
      attempts
    );
    if (committed.success) return result;
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
      return err(controlled.failure);
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
      return err(stoppedAfterSettle);
    }
    return controlled.value;
  }

  private cancelSession(
    session: E2ESessionInfo,
    authoritativeTarget: LoopSessionTarget,
    cancellationPromises: CancellationRegistry
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
    if (!committed.success) {
      return err(
        this.dependencyFailure(input, committed.error, 'progress', featureHead, attempt, [
          ...sessionAttempts,
        ])
      );
    }
    if (!sameE2EDurableProgress(committed.data, reduced.data)) {
      return err(
        this.failure(
          input,
          'progress-authority-invalid',
          'progress',
          'Progress persistence returned stale or drifted durable authority.',
          {
            featureHead,
            attempt,
            sessionAttempts: [...sessionAttempts],
          }
        )
      );
    }
    input.progress.current = copyE2EDurableProgress(committed.data);
    input.loop = { ...input.loop, state: input.progress.current.loopState };
    input.phase = { ...input.phase, state: input.progress.current.phaseState };
    return ok();
  }

  private async syncSessionProgress(
    input: NormalizedInput,
    featureHead: string,
    attempt: number,
    sessionAttempts: readonly LoopSessionAttempt[]
  ): Promise<Result<void, CleanRoomE2EGateError>> {
    const desired = [
      ...input.previousSessionAttempts.map(copyAttempt),
      ...sessionAttempts.map(copyAttempt),
    ];
    for (let index = 0; index < desired.length; index += 1) {
      const current = input.progress.current.loopState.sessionAttempts[index];
      const next = desired[index];
      if (current && JSON.stringify(current) === JSON.stringify(next)) continue;
      const committed = await this.commitProgress(
        input,
        {
          kind: 'session-attempt',
          ...(current ? { previous: current } : {}),
          next,
        },
        featureHead,
        attempt,
        sessionAttempts
      );
      if (!committed.success) return committed;
    }
    if (input.progress.current.loopState.sessionAttempts.length !== desired.length) {
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
    input: Pick<RunCleanRoomE2EGateInput, 'signal' | 'intermediateFailures'>,
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

function safeNormalizeInput(
  input: RunCleanRoomE2EGateInput
): Result<NormalizedInput, { type: string; message: string }> {
  try {
    return normalizeInput(input);
  } catch {
    return err({
      type: 'invalid-input',
      message: 'Loop E2E input could not be read safely.',
    });
  }
}

function normalizeInput(
  input: RunCleanRoomE2EGateInput
): Result<NormalizedInput, { type: string; message: string }> {
  if (
    !loopPromptContextInputSchema.safeParse({
      goal: input.goal,
      acceptanceCriteria: input.acceptanceCriteria,
      baseCommit: input.baseCommit,
      checkpointCommit: input.checkpointCommit,
      handoffs: input.handoffs,
    }).success ||
    !Array.isArray(input.handoffs) ||
    input.handoffs.some((handoff) => !tryCopyPromptHandoff(handoff))
  ) {
    return err({ type: 'invalid-input', message: 'Invalid bounded E2E prompt context.' });
  }
  const target = loopSessionTargetSchema.safeParse(input.featureTarget);
  if (!target.success || !isCanonicalTarget(input.featureTarget, target.data)) {
    return err({ type: 'invalid-input', message: 'Invalid feature execution target.' });
  }
  if (!loopProviderSchema.safeParse(input.provider).success) {
    return err({ type: 'invalid-input', message: 'Invalid E2E provider.' });
  }
  if (
    !loopTerminalGatesSchema.safeParse(input.terminalGates).success ||
    !Array.isArray(input.workPhaseResults) ||
    input.workPhaseResults.length > MAX_ATTEMPTS ||
    input.workPhaseResults.some((result) => !loopStageResultSchema.safeParse(result).success) ||
    (input.reviewStageResult !== undefined &&
      !loopStageResultSchema.safeParse(input.reviewStageResult).success)
  ) {
    return err({ type: 'invalid-input', message: 'Invalid terminal-gate stage authority.' });
  }
  if (
    typeof input.model !== 'string' ||
    input.model.trim().length === 0 ||
    input.model.length > MAX_MODEL_LENGTH
  ) {
    return err({ type: 'invalid-input', message: 'Invalid E2E model.' });
  }
  if (
    !Number.isInteger(input.maxAttempts) ||
    input.maxAttempts < 1 ||
    input.maxAttempts > MAX_ATTEMPTS
  ) {
    return err({ type: 'invalid-input', message: 'E2E maxAttempts must be between 1 and 64.' });
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
  const state = loopStateV1Schema.safeParse(input.loop.state);
  const phaseCriteria = e2ePhaseCriteriaSchema.safeParse(input.phase.criteria);
  const phaseState =
    input.phase.state === undefined || input.phase.state === null
      ? { success: true as const, data: null }
      : loopPhaseStateInputSchema.safeParse(input.phase.state);
  if (
    !config.success ||
    !state.success ||
    !phaseCriteria.success ||
    !phaseState.success ||
    !hasCanonicalPersistedLoopState(input.loop.state) ||
    !hasCanonicalPhaseState(input.phase.state)
  ) {
    return err({
      type: 'invalid-input',
      message: 'Loop E2E requires current persisted config, state, and phase criteria authority.',
    });
  }
  if (
    state.data.sessionAttempts.length + input.maxAttempts * MAX_SESSION_RECORDS_PER_E2E_ATTEMPT >
    MAX_SESSION_ATTEMPTS
  ) {
    return err({
      type: 'invalid-input',
      message: 'The durable session ledger lacks capacity for the bounded E2E attempt cap.',
    });
  }
  const validationCommands = validationCommandsSchema.safeParse(config.data.validationCommands);
  const criteria = e2eCriteriaSchema.safeParse(phaseCriteria.data.criteria);
  if (!validationCommands.success || !criteria.success) {
    return err({
      type: 'invalid-input',
      message: 'Loop E2E validation commands and criteria are invalid or unbounded.',
    });
  }
  const normalizedModel = input.model.trim();
  if (
    input.provider !== 'codex' ||
    config.data.provider !== input.provider ||
    config.data.model !== normalizedModel ||
    config.data.browserPreview.enabled !== true ||
    config.data.reviewEnabled !== config.data.terminalGates.review ||
    config.data.terminalGates.review !== input.terminalGates.review ||
    config.data.terminalGates.e2e !== input.terminalGates.e2e ||
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
  return ok({
    ...input,
    loop: {
      ...input.loop,
      config: { ...config.data, validationCommands: [...validationCommands.data] },
      state: state.data,
    },
    phase: { ...input.phase, criteria: phaseCriteria.data, state: phaseState.data },
    model: normalizedModel,
    terminalGates: { ...input.terminalGates },
    workPhaseResults: input.workPhaseResults.map((result) => loopStageResultSchema.parse(result)),
    handoffs: safeCopyPromptHandoffs(input.handoffs),
    intermediateFailures: persistedRetryHandoffs.map(copyPromptHandoff),
    featureTarget: target.data,
    validationCommands: [...validationCommands.data],
    criteria: criteria.data.map(copyCriterion),
    previousSessionAttempts: state.data.sessionAttempts.map(copyAttempt),
    progress: {
      current: copyE2EDurableProgress({
        loopState: state.data,
        phaseState: phaseState.data,
      }),
    },
  });
}

function terminalPrecondition(
  input: NormalizedInput
): { type: string; message: string } | undefined {
  const state = loopStateV1Schema.parse(input.loop.state);
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
  if (
    input.workPhaseResults.length === 0 ||
    input.workPhaseResults.some((result) => result.status !== 'passed')
  ) {
    return { type: 'work-phases-incomplete', message: 'Every work phase must pass before E2E.' };
  }
  if (input.terminalGates.review) {
    if (input.reviewStageResult?.status !== 'passed') {
      return {
        type: 'review-incomplete',
        message: 'Enabled terminal Review must pass before E2E.',
      };
    }
  } else if (input.reviewStageResult !== undefined) {
    return {
      type: 'review-order-invalid',
      message: 'A Review result cannot be supplied when terminal Review is disabled.',
    };
  }
  return undefined;
}

function validateCleanRoom(
  cleanRoom: CleanRoomWorkspace,
  input: NormalizedInput,
  verificationRunId: string,
  attempt: number,
  featureHead: string
): { type: string; message: string } | undefined {
  const parsedTarget = loopSessionTargetSchema.safeParse(
    cleanRoom && typeof cleanRoom === 'object' ? cleanRoom.target : undefined
  );
  if (
    !cleanRoom ||
    typeof cleanRoom !== 'object' ||
    cleanRoom.projectId !== input.project.projectId ||
    cleanRoom.verificationRunId !== verificationRunId ||
    cleanRoom.attempt !== attempt ||
    cleanRoom.baseCommit !== input.baseCommit ||
    cleanRoom.expectedFeatureHead !== featureHead ||
    cleanRoom.replayedThroughCommit !== featureHead ||
    !validId(cleanRoom.cleanupId) ||
    !validId(cleanRoom.branchName) ||
    !parsedTarget.success
  ) {
    return {
      type: 'clean-room-authority-invalid',
      message: 'Clean-room identity attestation is invalid.',
    };
  }
  if (!isCanonicalTarget(cleanRoom.target, parsedTarget.data)) {
    return {
      type: 'target-drift',
      message: 'Clean-room target authority is not canonical.',
    };
  }
  if (
    !sameMachine(parsedTarget.data, input.featureTarget) ||
    parsedTarget.data.workspaceId === input.featureTarget.workspaceId ||
    parsedTarget.data.path === input.featureTarget.path
  ) {
    return {
      type: 'target-drift',
      message: 'Clean room must be a distinct disposable workspace on the feature machine.',
    };
  }
  return undefined;
}

function validateBinding(
  binding: E2EExecutionBinding,
  target: LoopSessionTarget,
  input: NormalizedInput
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
    !sameTarget(binding.executionTarget, target)
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
  if (
    keys.length !== TRUSTED_TASK_ENVIRONMENT_KEYS.length ||
    TRUSTED_TASK_ENVIRONMENT_KEYS.some((key) => !keys.includes(key)) ||
    !valuesAreBoundedStrings ||
    environmentBytes > MAX_TASK_ENVIRONMENT_BYTES ||
    binding.taskEnvironment.EMDASH_TASK_ID !== input.task.id ||
    binding.taskEnvironment.EMDASH_TASK_NAME !== input.task.name ||
    binding.taskEnvironment.EMDASH_TASK_PATH !== target.path ||
    binding.taskEnvironment.EMDASH_ROOT_PATH !== input.project.repoPath
  ) {
    return {
      type: 'task-environment-invalid',
      message: 'Trusted task environment is not the exact six-key overlay.',
      safeToRelease: true,
    };
  }
  return undefined;
}

function validateBeginning(
  authority: E2EAttemptAuthority,
  target: LoopSessionTarget,
  featureHead: string
): { type: string; message: string } | undefined {
  if (
    !authority ||
    typeof authority !== 'object' ||
    !sameTarget(authority.target, target) ||
    !validId(authority.mutationBaseline) ||
    !validCommit(authority.headCommit) ||
    typeof authority.clean !== 'boolean' ||
    typeof authority.branchAttached !== 'boolean'
  ) {
    return {
      type: 'authority-invalid',
      message: 'Attempt authority returned invalid target or baseline.',
    };
  }
  if (authority.headCommit !== featureHead) {
    return {
      type: 'checkpoint-drift',
      message: 'Fresh clean-room head does not match feature authority.',
    };
  }
  if (!authority.clean || !authority.branchAttached) {
    return { type: 'dirty-workspace', message: 'Fresh clean room is not clean and attached.' };
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

function freshAttemptIdentity(
  attempt: LoopSessionAttempt,
  input: NormalizedInput,
  currentAttempts: readonly LoopSessionAttempt[]
): boolean {
  return ![...input.previousSessionAttempts, ...currentAttempts].some(
    (existing) =>
      existing.attemptId === attempt.attemptId || existing.conversationId === attempt.conversationId
  );
}

function sameSessionIdentity(
  left: Pick<E2ESessionInfo, 'attemptId' | 'conversationId'>,
  right: Pick<E2ESessionInfo, 'attemptId' | 'conversationId'>
): boolean {
  return left.attemptId === right.attemptId && left.conversationId === right.conversationId;
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

function validateInspection(
  inspection: E2EAttemptInspection,
  target: LoopSessionTarget,
  mutationBaseline: string
): { type: string; message: string } | undefined {
  if (
    !inspection ||
    typeof inspection !== 'object' ||
    !sameTarget(inspection.target, target) ||
    inspection.mutationBaseline !== mutationBaseline ||
    !validCommit(inspection.headCommit) ||
    typeof inspection.mutated !== 'boolean'
  ) {
    return { type: 'authority-invalid', message: 'Attempt inspection returned invalid authority.' };
  }
  if (!inspection.clean || !inspection.branchAttached) {
    return { type: 'dirty-workspace', message: 'Attempt workspace is not clean and attached.' };
  }
  return undefined;
}

function validateCorrectionInspection(
  inspection: E2EAttemptInspection,
  featureHead: string
): { type: string; message: string } | undefined {
  if (!inspection.mutated || inspection.headCommit === featureHead) {
    return {
      type: 'correction-authority-invalid',
      message: 'Correction-ready requires trusted mutation and one changed clean checkpoint.',
    };
  }
  return undefined;
}

function validatePassInspection(
  inspection: E2EAttemptInspection,
  featureHead: string
): { type: string; message: string } | undefined {
  if (inspection.mutated) {
    return {
      type: 'mutation-concealed',
      message: 'A mutated attempt cannot be a fresh pass candidate.',
    };
  }
  if (inspection.headCommit !== featureHead) {
    return {
      type: 'checkpoint-drift',
      message: 'Pass candidate changed the clean-room checkpoint.',
    };
  }
  return undefined;
}

function settlePreallocatedNestedAttempt(
  attempts: LoopSessionAttempt[],
  index: number,
  value: unknown,
  active: ActiveAttempt,
  featureHead: string,
  input: NormalizedInput,
  settledAt: string
): void {
  const starting = attempts[index];
  if (!starting || starting.purpose !== 'browser-verification') return;
  let candidates: unknown;
  try {
    candidates =
      value && typeof value === 'object'
        ? (value as { sessionAttempts?: unknown }).sessionAttempts
        : undefined;
  } catch {
    candidates = undefined;
  }
  if (Array.isArray(candidates)) {
    for (const candidate of candidates.slice(0, 3)) {
      const adopted = normalizeNestedAttempt(
        candidate,
        starting,
        active,
        featureHead,
        input,
        settledAt
      );
      if (adopted) {
        attempts[index] = adopted;
        return;
      }
    }
  }
  markNestedAttemptInterrupted(
    attempts,
    index,
    settledAt,
    'Nested verification settled quiescently without exact terminal evidence.'
  );
}

function normalizeNestedAttempt(
  value: unknown,
  starting: LoopSessionAttempt,
  active: ActiveAttempt,
  featureHead: string,
  input: NormalizedInput,
  settledAt: string
): LoopSessionAttempt | undefined {
  const parsed = loopSessionAttemptSchema.safeParse(value);
  if (
    !parsed.success ||
    !hasCanonicalAttemptFields(value, parsed.data) ||
    parsed.data.attemptId !== starting.attemptId ||
    parsed.data.conversationId !== starting.conversationId ||
    parsed.data.purpose !== 'browser-verification' ||
    parsed.data.phaseId !== input.phase.id ||
    parsed.data.verificationRunId !== active.verificationRunId ||
    parsed.data.checkpointBefore !== featureHead ||
    (parsed.data.checkpointAfter !== undefined && parsed.data.checkpointAfter !== featureHead) ||
    parsed.data.conversationId === active.session.conversationId ||
    !sameTarget(parsed.data.target, active.cleanRoom.target)
  ) {
    return undefined;
  }
  const terminal = ['completed', 'failed', 'cancelled', 'interrupted'].includes(parsed.data.status);
  if (terminal && parsed.data.finishedAt === undefined) return undefined;
  if (parsed.data.status === 'completed' && parsed.data.checkpointAfter !== featureHead) {
    return undefined;
  }
  return copyAttempt({
    ...parsed.data,
    startedAt: starting.startedAt,
    ...(terminal
      ? {}
      : {
          status: 'interrupted',
          finishedAt: settledAt,
          error: 'Nested verification settled quiescently without terminal evidence.',
        }),
  });
}

function markNestedAttemptInterrupted(
  attempts: LoopSessionAttempt[],
  index: number,
  finishedAt: string,
  error: string
): void {
  const current = attempts[index];
  if (!current) return;
  attempts[index] = copyAttempt({
    ...current,
    status: 'interrupted',
    finishedAt,
    error,
  });
}

function validateRequiredChecks(
  checks: E2ERequiredChecksResult,
  active: ActiveAttempt,
  featureHead: string,
  input: NormalizedInput,
  existingAttempts: readonly LoopSessionAttempt[],
  preallocatedAttempt: LoopSessionAttempt
): { type: string; message: string } | undefined {
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
    !sameEnvironment(checks.nativePreview.taskEnvironment, active.binding.taskEnvironment)
  ) {
    return {
      type: 'native-verifier-authority-invalid',
      message: 'Exactly one target-bound native verifier invocation is required.',
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

function validatePostChecks(
  inspection: E2EAttemptInspection,
  target: LoopSessionTarget,
  mutationBaseline: string,
  featureHead: string
): { type: string; message: string } | undefined {
  const common = validateInspection(inspection, target, mutationBaseline);
  if (common) return common;
  if (inspection.mutated || inspection.headCommit !== featureHead) {
    return {
      type: 'post-check-drift',
      message: 'Required checks mutated or moved the clean-room checkpoint.',
    };
  }
  return undefined;
}

function validateFeature(
  feature: E2EFeatureInspection,
  target: LoopSessionTarget,
  featureHead: string
): { type: string; message: string } | undefined {
  if (
    !feature ||
    typeof feature !== 'object' ||
    !loopSessionTargetSchema.safeParse(feature.target).success ||
    !validCommit(feature.headCommit) ||
    typeof feature.clean !== 'boolean' ||
    typeof feature.branchAttached !== 'boolean'
  ) {
    return {
      type: 'feature-authority-invalid',
      message: 'Feature inspection returned malformed authority.',
    };
  }
  if (!sameTarget(feature.target, target) || feature.headCommit !== featureHead) {
    return {
      type: 'feature-head-drift',
      message: 'Feature authority drifted before E2E completion.',
    };
  }
  if (!feature.clean || !feature.branchAttached) {
    return { type: 'dirty-feature', message: 'Feature workspace is not clean and attached.' };
  }
  return undefined;
}

function tryMakeOuterAttempt(
  session: unknown,
  authoritativeTarget: LoopSessionTarget,
  checkpoint: string,
  startedAt: string
): LoopSessionAttempt | undefined {
  if (!session || typeof session !== 'object') return undefined;
  const candidate = session as Partial<E2ESessionInfo>;
  const parsed = loopSessionAttemptSchema.safeParse({
    attemptId: candidate.attemptId,
    conversationId: candidate.conversationId,
    purpose: candidate.purpose,
    phaseId: candidate.phaseId,
    verificationRunId: candidate.verificationRunId,
    target: copyTarget(authoritativeTarget),
    status: 'running',
    checkpointBefore: checkpoint,
    startedAt,
  });
  return parsed.success ? parsed.data : undefined;
}

function hasUsableCancellationIdentity(value: unknown): value is E2ESessionInfo {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<E2ESessionInfo>;
  return (
    validId(candidate.attemptId) &&
    validId(candidate.conversationId) &&
    candidate.purpose === 'e2e' &&
    validId(candidate.phaseId) &&
    validId(candidate.verificationRunId) &&
    Number.isInteger(candidate.attempt) &&
    (candidate.attempt ?? 0) > 0 &&
    (candidate.attempt ?? 0) <= MAX_ATTEMPTS
  );
}

function markOuterAttempt(
  attempts: LoopSessionAttempt[],
  index: number,
  status: 'completed' | 'failed' | 'cancelled' | 'interrupted',
  finishedAt: Date,
  extra: { checkpointAfter?: string; error?: string } = {}
): void {
  const current = attempts[index];
  if (!current) return;
  attempts[index] = loopSessionAttemptSchema.parse({
    ...current,
    status,
    finishedAt: finishedAt.toISOString(),
    ...(extra.checkpointAfter ? { checkpointAfter: extra.checkpointAfter } : {}),
    ...(extra.error ? { error: boundedSummary(extra.error, 'E2E attempt failed.') } : {}),
  });
}

function copyAttempt(attempt: LoopSessionAttempt): LoopSessionAttempt {
  return loopSessionAttemptSchema.parse({
    ...attempt,
    ...(attempt.error !== undefined
      ? { error: boundedSummary(attempt.error, 'E2E attempt failed.') }
      : {}),
  });
}

function verificationProgress(input: {
  verificationRunId: string;
  attempt: number;
  status: LoopVerificationWorkspaceState['status'];
  baseCommit: string;
  featureHead: string;
  updatedAt: string;
  cleanRoom?: CleanRoomWorkspace;
  cleanupStatus?: LoopVerificationWorkspaceState['cleanup']['status'];
  cleanupError?: string;
}): LoopVerificationWorkspaceState {
  return {
    verificationRunId: input.verificationRunId,
    attempt: input.attempt,
    status: input.status,
    ...(input.cleanRoom ? { target: copyTarget(input.cleanRoom.target) } : {}),
    baseCommit: input.baseCommit,
    ...(input.cleanRoom ? { replayedThroughCommit: input.featureHead } : {}),
    expectedFeatureHead: input.featureHead,
    cleanup: {
      status: input.cleanupStatus ?? 'pending',
      updatedAt: input.updatedAt,
      ...(input.cleanupError
        ? { error: boundedSummary(input.cleanupError, 'Workspace cleanup failed.') }
        : {}),
    },
  };
}

function copyCriterion(criterion: LoopPhaseCriterion): LoopPhaseCriterion {
  return loopPhaseCriterionSchema.parse(criterion);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameCriteria(
  left: readonly LoopPhaseCriterion[],
  right: readonly LoopPhaseCriterion[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => {
      const expected = right[index];
      return (
        !!expected &&
        value.description === expected.description &&
        value.verifier === expected.verifier &&
        value.status === expected.status &&
        value.evidence === expected.evidence
      );
    })
  );
}

function copyPromptHandoff(handoff: LoopPromptHandoff): LoopPromptHandoff {
  const parsed = loopPromptHandoffSchema.parse(handoff);
  if (
    !validId(parsed.source) ||
    !validTimestamp(parsed.handoff.createdAt) ||
    parsed.handoff.artifacts.some(
      (artifact) => !validId(artifact.artifactId) || !validTimestamp(artifact.createdAt)
    )
  ) {
    throw new TypeError('Prompt handoff contains non-canonical persisted authority.');
  }
  return loopPromptHandoffSchema.parse({
    source: boundedSummary(parsed.source, 'Redacted handoff').slice(0, 256),
    handoff: {
      summary: boundedSummary(parsed.handoff.summary, 'Redacted handoff summary.'),
      risks: parsed.handoff.risks.map((risk) =>
        boundedSummary(risk, 'Redacted risk.').slice(0, 2_048)
      ),
      remainingWork: parsed.handoff.remainingWork.map((item) =>
        boundedSummary(item, 'Redacted remaining work.').slice(0, 2_048)
      ),
      artifacts: parsed.handoff.artifacts.map((artifact) => ({
        artifactId: artifact.artifactId,
        kind: artifact.kind,
        ...(artifact.label !== undefined
          ? { label: boundedSummary(artifact.label, 'Redacted artifact.').slice(0, 256) }
          : {}),
        ...(artifact.mimeType !== undefined
          ? {
              mimeType: boundedSummary(artifact.mimeType, 'application/octet-stream').slice(0, 128),
            }
          : {}),
        byteLength: artifact.byteLength,
        createdAt: artifact.createdAt,
      })),
      createdAt: parsed.handoff.createdAt,
    },
  });
}

function tryCopyPromptHandoff(value: unknown): LoopPromptHandoff | undefined {
  try {
    return copyPromptHandoff(value as LoopPromptHandoff);
  } catch {
    return undefined;
  }
}

function safeCopyPromptHandoffs(value: unknown): LoopPromptHandoff[] {
  if (!Array.isArray(value)) return [];
  const copied: LoopPromptHandoff[] = [];
  for (const candidate of value.slice(0, 64)) {
    const copy = tryCopyPromptHandoff(candidate);
    if (copy) copied.push(copy);
  }
  return copied;
}

function safePendingCleanup(
  value: unknown,
  input: RunCleanRoomE2EGateInput,
  stage: CleanRoomE2EGateStage,
  pendingWorkspace?: E2EPendingWorkspaceAuthority
): CleanRoomPendingCleanup | undefined {
  if (value === undefined || stage !== 'cleanup' || !pendingWorkspace) return undefined;
  const parsed = parseCleanRoomPendingCleanup(value);
  if (!parsed.success) return undefined;
  const record = parsed.data;
  if (
    record.projectId !== pendingWorkspace.projectId ||
    record.projectId !== input.project.projectId ||
    record.cleanupId !== pendingWorkspace.cleanupId ||
    record.verificationRunId !== pendingWorkspace.verificationRunId ||
    record.attempt !== pendingWorkspace.attempt ||
    record.workspaceId !== pendingWorkspace.target.workspaceId ||
    record.target.path !== pendingWorkspace.target.path ||
    !sameMachine(
      { ...pendingWorkspace.target, path: record.target.path, machine: record.target.machine },
      pendingWorkspace.target
    ) ||
    !sameTarget(record.featureTarget, input.featureTarget) ||
    record.baseCommit !== input.baseCommit ||
    record.expectedFeatureHead !== pendingWorkspace.expectedFeatureHead
  ) {
    return undefined;
  }
  return clonePendingCleanup(record);
}

function safeCreatePendingCleanup(
  value: unknown,
  input: NormalizedInput,
  verificationRunId: string,
  attempt: number,
  featureHead: string
): CleanRoomPendingCleanup | undefined {
  const parsed = parseCleanRoomPendingCleanup(value);
  if (!parsed.success) return undefined;
  const record = parsed.data;
  const target: LoopSessionTarget = {
    workspaceId: record.workspaceId,
    path: record.target.path,
    machine: record.target.machine,
  };
  if (
    record.projectId !== input.project.projectId ||
    record.verificationRunId !== verificationRunId ||
    record.attempt !== attempt ||
    !sameTarget(record.featureTarget, input.featureTarget) ||
    !sameMachine(target, input.featureTarget) ||
    target.workspaceId === input.featureTarget.workspaceId ||
    target.path === input.featureTarget.path ||
    record.baseCommit !== input.baseCommit ||
    record.expectedFeatureHead !== featureHead
  ) {
    return undefined;
  }
  return clonePendingCleanup(record);
}

function pendingWorkspaceFromCleanup(
  cleanup: CleanRoomPendingCleanup
): E2EPendingWorkspaceAuthority {
  return {
    projectId: cleanup.projectId,
    cleanupId: cleanup.cleanupId,
    verificationRunId: cleanup.verificationRunId,
    attempt: cleanup.attempt,
    target: {
      workspaceId: cleanup.workspaceId,
      path: cleanup.target.path,
      machine: { ...cleanup.target.machine },
    },
    expectedFeatureHead: cleanup.expectedFeatureHead,
  };
}

function pendingWorkspaceAuthority(cleanRoom: CleanRoomWorkspace): E2EPendingWorkspaceAuthority {
  return {
    projectId: cleanRoom.projectId,
    cleanupId: cleanRoom.cleanupId,
    verificationRunId: cleanRoom.verificationRunId,
    attempt: cleanRoom.attempt,
    target: copyTarget(cleanRoom.target),
    expectedFeatureHead: cleanRoom.expectedFeatureHead,
  };
}

function clonePendingWorkspace(
  authority: E2EPendingWorkspaceAuthority
): E2EPendingWorkspaceAuthority {
  return {
    ...authority,
    target: copyTarget(authority.target),
  };
}

function copyTarget(target: LoopSessionTarget): LoopSessionTarget {
  return loopSessionTargetSchema.parse(target);
}

function isCanonicalTarget(value: unknown, canonical: LoopSessionTarget): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LoopSessionTarget>;
  if (!candidate.machine || typeof candidate.machine !== 'object') return false;
  return (
    candidate.workspaceId === canonical.workspaceId &&
    candidate.path === canonical.path &&
    candidate.machine.kind === canonical.machine.kind &&
    (canonical.machine.kind === 'local' ||
      (candidate.machine.kind === 'ssh' &&
        candidate.machine.connectionId === canonical.machine.connectionId))
  );
}

function copyEnvironment(
  environment: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  return Object.freeze({ ...environment });
}

function sameEnvironment(left: unknown, right: unknown): boolean {
  const parsedLeft = trustedTaskEnvironmentSchema.safeParse(left);
  const parsedRight = trustedTaskEnvironmentSchema.safeParse(right);
  if (!parsedLeft.success || !parsedRight.success) return false;
  const leftEnvironment = parsedLeft.data;
  const rightEnvironment = parsedRight.data;
  const leftKeys = Object.keys(leftEnvironment).sort();
  const rightKeys = Object.keys(rightEnvironment).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && leftEnvironment[key] === rightEnvironment[key]
    )
  );
}

function sameTarget(left: unknown, right: unknown): boolean {
  const parsedLeft = parseTargetLike(left);
  const parsedRight = parseTargetLike(right);
  if (
    !parsedLeft.success ||
    !parsedRight.success ||
    !isCanonicalTarget(left, parsedLeft.data) ||
    !isCanonicalTarget(right, parsedRight.data)
  ) {
    return false;
  }
  const leftTarget = parsedLeft.data;
  const rightTarget = parsedRight.data;
  return (
    leftTarget.workspaceId === rightTarget.workspaceId &&
    leftTarget.path === rightTarget.path &&
    leftTarget.machine.kind === rightTarget.machine.kind &&
    (leftTarget.machine.kind === 'local' ||
      (rightTarget.machine.kind === 'ssh' &&
        leftTarget.machine.connectionId === rightTarget.machine.connectionId))
  );
}

function hasCanonicalAttemptTarget(candidate: unknown, expected: LoopSessionTarget): boolean {
  try {
    return (
      !!candidate &&
      typeof candidate === 'object' &&
      sameTarget((candidate as { target?: unknown }).target, expected)
    );
  } catch {
    return false;
  }
}

function hasCanonicalAttemptFields(candidate: unknown, parsed: LoopSessionAttempt): boolean {
  try {
    if (!candidate || typeof candidate !== 'object') return false;
    const raw = candidate as Partial<LoopSessionAttempt>;
    return (
      validId(raw.attemptId) &&
      validId(raw.conversationId) &&
      (raw.phaseId === undefined || validId(raw.phaseId)) &&
      (raw.verificationRunId === undefined || validId(raw.verificationRunId)) &&
      validTimestamp(raw.startedAt) &&
      (raw.finishedAt === undefined || validTimestamp(raw.finishedAt)) &&
      raw.attemptId === parsed.attemptId &&
      raw.conversationId === parsed.conversationId &&
      raw.phaseId === parsed.phaseId &&
      raw.verificationRunId === parsed.verificationRunId &&
      raw.startedAt === parsed.startedAt &&
      raw.finishedAt === parsed.finishedAt &&
      hasCanonicalAttemptTarget(candidate, parsed.target)
    );
  } catch {
    return false;
  }
}

function hasCanonicalPersistedLoopState(value: unknown): boolean {
  try {
    if (!value || typeof value !== 'object') return false;
    const state = value as {
      sessionAttempts?: unknown;
      verification?: unknown;
    };
    if (
      !Array.isArray(state.sessionAttempts) ||
      state.sessionAttempts.some((attempt) => {
        const parsed = loopSessionAttemptSchema.safeParse(attempt);
        return !parsed.success || !hasCanonicalAttemptFields(attempt, parsed.data);
      })
    ) {
      return false;
    }
    if (state.verification === null) return true;
    if (!state.verification || typeof state.verification !== 'object') return false;
    const verification = state.verification as {
      verificationRunId?: unknown;
      target?: unknown;
      cleanup?: unknown;
    };
    if (!validId(verification.verificationRunId)) return false;
    if (verification.target !== undefined) {
      const target = loopSessionTargetSchema.safeParse(verification.target);
      if (!target.success || !isCanonicalTarget(verification.target, target.data)) return false;
    }
    if (!verification.cleanup || typeof verification.cleanup !== 'object') return false;
    const cleanup = verification.cleanup as { updatedAt?: unknown; error?: unknown };
    return (
      validTimestamp(cleanup.updatedAt) &&
      (cleanup.error === undefined ||
        (typeof cleanup.error === 'string' && redactPersistedText(cleanup.error) === cleanup.error))
    );
  } catch {
    return false;
  }
}

function hasCanonicalPhaseState(value: unknown): boolean {
  try {
    if (value === undefined || value === null) return true;
    if (!value || typeof value !== 'object') return false;
    const state = value as {
      version?: unknown;
      handoff?: unknown;
      retryHandoffs?: unknown;
      result?: unknown;
    };
    if (
      state.handoff !== null &&
      state.handoff !== undefined &&
      !hasCanonicalPhaseHandoff(state.handoff)
    ) {
      return false;
    }
    if (state.version === '2') {
      if (
        !Array.isArray(state.retryHandoffs) ||
        state.retryHandoffs.some((handoff) => !tryCopyPromptHandoff(handoff))
      ) {
        return false;
      }
    }
    if (state.result !== null && state.result !== undefined) {
      if (!state.result || typeof state.result !== 'object') return false;
      if (!validTimestamp((state.result as { completedAt?: unknown }).completedAt)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function hasCanonicalPhaseHandoff(value: unknown): boolean {
  try {
    if (!value || typeof value !== 'object') return false;
    const handoff = value as { artifacts?: unknown; createdAt?: unknown };
    if (!validTimestamp(handoff.createdAt) || !Array.isArray(handoff.artifacts)) return false;
    return handoff.artifacts.every((candidate) => {
      if (!candidate || typeof candidate !== 'object') return false;
      const artifact = candidate as { artifactId?: unknown; createdAt?: unknown };
      return validId(artifact.artifactId) && validTimestamp(artifact.createdAt);
    });
  } catch {
    return false;
  }
}

function parseTargetLike(value: unknown): ReturnType<typeof loopSessionTargetSchema.safeParse> {
  if (!value || typeof value !== 'object') return loopSessionTargetSchema.safeParse(value);
  const candidate = value as Partial<LoopSessionTarget>;
  return loopSessionTargetSchema.safeParse({
    workspaceId: candidate.workspaceId,
    path: candidate.path,
    machine: candidate.machine,
  });
}

function sameMachine(left: LoopSessionTarget, right: LoopSessionTarget): boolean {
  return (
    left.machine.kind === right.machine.kind &&
    (left.machine.kind === 'local' ||
      (right.machine.kind === 'ssh' && left.machine.connectionId === right.machine.connectionId))
  );
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    redactPersistedText(value) === value
  );
}

function validCommit(value: unknown): value is string {
  return loopCommitSchema.safeParse(value).success;
}

function validTimestamp(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    value.length === 0 ||
    value.length > 64 ||
    redactPersistedText(value) !== value
  ) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function validAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== 'undefined' && value instanceof AbortSignal;
}

function boundedSummary(value: unknown, fallback: string): string {
  const candidate = typeof value === 'string' ? value : fallback;
  const redacted = redactPersistedText(candidate).trim();
  return (redacted || redactPersistedText(fallback)).slice(0, MAX_SUMMARY_LENGTH);
}

function redactPersistedText(value: string): string {
  return redactAll(value.replace(cookieAssignmentPattern, '[REDACTED_COOKIE]'));
}

function safeDate(now: () => Date): Date {
  try {
    const value = now();
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return new Date(value.getTime());
    }
  } catch {
    // A valid fallback keeps lifecycle cleanup and durable evidence available.
  }
  return new Date();
}

function safeNow(now: () => Date): string {
  return safeDate(now).toISOString();
}

async function raceWithControl<T>(
  operation: Promise<Extract<ControlledDependencyOutcome<T>, { kind: 'completed' }>>,
  input: Pick<RunCleanRoomE2EGateInput, 'signal' | 'deadlineAt'>
): Promise<ControlledDependencyOutcome<T>> {
  const signal = input.signal;
  if (!signal && input.deadlineAt === undefined) return operation;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let detachAbort: (() => void) | undefined;
  const stopped = new Promise<Extract<ControlledDependencyOutcome<T>, { kind: 'stopped' }>>(
    (resolve) => {
      const stop = () => {
        const failure = controlFailure(input);
        if (failure) resolve({ kind: 'stopped', failure });
      };
      if (signal) {
        AbortSignal.prototype.addEventListener.call(signal, 'abort', stop, { once: true });
        detachAbort = () => AbortSignal.prototype.removeEventListener.call(signal, 'abort', stop);
      }
      if (input.deadlineAt !== undefined) {
        timeout = setTimeout(
          () =>
            resolve({
              kind: 'stopped',
              failure: {
                type: 'deadline-exceeded',
                message: 'Clean-room E2E deadline was exceeded.',
              },
            }),
          Math.max(0, input.deadlineAt - Date.now())
        );
      }
      stop();
    }
  );

  try {
    return await Promise.race([operation, stopped]);
  } finally {
    if (timeout) clearTimeout(timeout);
    detachAbort?.();
  }
}

function normalizeDependencyResult<T>(
  value: unknown,
  label: string,
  stabilizeSuccess?: SuccessStabilizer<T>
): Result<T, E2EGateDependencyError> {
  try {
    if (!value || typeof value !== 'object') throw new TypeError('Invalid result');
    const candidate = value as {
      success?: unknown;
      data?: T;
      error?: E2EGateDependencyError & { sessionAttempts?: unknown };
    };
    if (candidate.success === true && 'data' in candidate) {
      const data = candidate.data;
      if (!stabilizeSuccess) return ok(data as T);
      const stable = stabilizeSuccess(data);
      if (stable === undefined) throw new TypeError('Invalid success payload');
      return ok(stable);
    }
    if (candidate.success !== false || !candidate.error || typeof candidate.error !== 'object') {
      throw new TypeError('Invalid result');
    }
    const dependencyError = candidate.error;
    if (typeof dependencyError.message !== 'string') throw new TypeError('Invalid error');
    return err({
      ...(typeof dependencyError.type === 'string' ? { type: dependencyError.type } : {}),
      ...(typeof dependencyError.kind === 'string' ? { kind: dependencyError.kind } : {}),
      message: dependencyError.message,
      ...('pendingCleanup' in dependencyError
        ? { pendingCleanup: dependencyError.pendingCleanup }
        : {}),
      ...('sessionAttempts' in dependencyError
        ? { sessionAttempts: dependencyError.sessionAttempts }
        : {}),
    } as E2EGateDependencyError);
  } catch {
    return err({
      type: 'untrusted-settlement',
      message: `${label} returned an invalid result.`,
    });
  }
}

function stabilizePlainSuccess<T>(value: unknown): T | undefined {
  try {
    const serialized = JSON.stringify(value);
    if (
      serialized === undefined ||
      Buffer.byteLength(serialized, 'utf8') > MAX_STABLE_SUCCESS_BYTES
    ) {
      return undefined;
    }
    return JSON.parse(serialized) as T;
  } catch {
    return undefined;
  }
}

function stabilizeExecutionBinding(value: unknown): E2EExecutionBinding | undefined {
  try {
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as E2EExecutionBinding;
    const target = stabilizePlainSuccess<LoopSessionTarget>(candidate.target);
    const taskEnvironment = stabilizePlainSuccess<Record<string, string>>(
      candidate.taskEnvironment
    );
    const rawExecutionTarget = candidate.executionTarget;
    if (!rawExecutionTarget || typeof rawExecutionTarget !== 'object') return undefined;
    const executionTargetIdentity = stabilizePlainSuccess<LoopSessionTarget>({
      workspaceId: rawExecutionTarget.workspaceId,
      path: rawExecutionTarget.path,
      machine: rawExecutionTarget.machine,
    });
    const executionTaskEnvironment = stabilizePlainSuccess<Record<string, string>>(
      rawExecutionTarget.taskEnv
    );
    const executionContext = rawExecutionTarget.executionContext;
    const dispose = rawExecutionTarget.dispose;
    if (
      !target ||
      !taskEnvironment ||
      !executionTargetIdentity ||
      !executionTaskEnvironment ||
      !executionContext ||
      typeof executionContext !== 'object' ||
      typeof dispose !== 'function'
    ) {
      return undefined;
    }
    return {
      target,
      taskEnvironment,
      executionTarget: {
        ...executionTargetIdentity,
        executionContext,
        taskEnv: executionTaskEnvironment,
        dispose: () => dispose.call(rawExecutionTarget),
      },
    };
  } catch {
    return undefined;
  }
}

function stabilizeDurableProgress(value: unknown): E2EDurableProgress | undefined {
  try {
    return copyE2EDurableProgress(value as E2EDurableProgress);
  } catch {
    return undefined;
  }
}

function errorMessage(cause: unknown): string {
  try {
    return boundedSummary(
      cause instanceof Error ? cause.message : String(cause),
      'Unknown dependency failure.'
    );
  } catch {
    return 'Unknown dependency failure.';
  }
}

function controlFailure(
  input: Pick<RunCleanRoomE2EGateInput, 'signal' | 'deadlineAt'>
): { type: 'cancelled' | 'deadline-exceeded'; message: string } | undefined {
  if (input.signal && signalAborted(input.signal)) {
    return { type: 'cancelled', message: 'Clean-room E2E was cancelled.' };
  }
  if (input.deadlineAt !== undefined && Date.now() >= input.deadlineAt) {
    return { type: 'deadline-exceeded', message: 'Clean-room E2E deadline was exceeded.' };
  }
  return undefined;
}

function signalAborted(signal: AbortSignal): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted');
  return descriptor?.get?.call(signal) === true;
}

function remainingTimeout(input: Pick<RunCleanRoomE2EGateInput, 'deadlineAt'>): number | undefined {
  if (input.deadlineAt === undefined) return undefined;
  return Math.max(1, Math.min(2_147_483_647, input.deadlineAt - Date.now()));
}
