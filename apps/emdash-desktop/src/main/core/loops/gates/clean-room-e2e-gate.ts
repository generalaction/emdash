import { err, ok, type Result } from '@main/lib/result';
import { loopStageResultSchema, type LoopStageResult } from '@shared/core/loops/loop-phase-state';
import {
  loopCommitSchema,
  loopSessionAttemptSchema,
  loopSessionTargetSchema,
  type LoopSessionAttempt,
  type LoopSessionTarget,
} from '@shared/core/loops/loop-state';
import {
  loopProviderSchema,
  type Loop,
  type LoopPhase,
  type LoopProviderId,
  type LoopTerminalGates,
} from '@shared/core/loops/loops';
import type {
  CleanRoomProject,
  CleanRoomWorkspace,
} from '../clean-room/clean-room-workspace-service';
import { buildE2EPrompt, parseE2ESentinel } from '../e2e-prompt';
import {
  loopPromptContextInputSchema,
  loopPromptHandoffSchema,
  type LoopPromptContextInput,
  type LoopPromptHandoff,
} from '../handoff-builder';
import type { LoopExecutionTarget } from '../runtime/loop-execution-target';

const MAX_ATTEMPTS = 64;
const MAX_ID_LENGTH = 256;
const MAX_MODEL_LENGTH = 256;
const MAX_SUMMARY_LENGTH = 16_384;
const TRUSTED_TASK_ENVIRONMENT_KEYS = [
  'EMDASH_DEFAULT_BRANCH',
  'EMDASH_PORT',
  'EMDASH_ROOT_PATH',
  'EMDASH_TASK_ID',
  'EMDASH_TASK_NAME',
  'EMDASH_TASK_PATH',
] as const;

export type E2EGateDependencyError = {
  type?: string;
  kind?: string;
  message: string;
  pendingCleanup?: unknown;
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
  verificationRunId: string;
  attempt: number;
  target: LoopSessionTarget;
  provider: LoopProviderId;
  model: string;
  taskEnvironment: Readonly<Record<string, string>>;
};

export type E2ERequiredChecksResult = {
  status: 'passed' | 'correctable' | 'failed';
  verificationRunId: string;
  attempt: number;
  outerConversationId: string;
  target: LoopSessionTarget;
  executionTarget: LoopSessionTarget;
  checkpointCommit: string;
  provider: LoopProviderId;
  model: string;
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
    verificationRunId: string;
    attempt: number;
    target: LoopSessionTarget;
    prompt: string;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): Promise<
    Result<
      {
        conversationId: string;
        verificationRunId: string;
        attempt: number;
        target: LoopSessionTarget;
        finalText: string;
      },
      E2EGateDependencyError
    >
  >;
  cancelE2ESession(input: {
    attemptId: string;
    conversationId: string;
    verificationRunId: string;
    attempt: number;
    target: LoopSessionTarget;
  }): Promise<
    Result<
      {
        attemptId: string;
        conversationId: string;
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
  run(input: {
    verificationRunId: string;
    attempt: number;
    conversationId: string;
    target: LoopSessionTarget;
    executionTarget: LoopExecutionTarget;
    taskEnvironment: Readonly<Record<string, string>>;
    checkpointCommit: string;
    provider: LoopProviderId;
    model: string;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): Promise<Result<E2ERequiredChecksResult, E2EGateDependencyError>>;
};

export type CleanRoomE2EGateDependencies = {
  cleanRoom: E2ECleanRoomPort;
  authority: E2EAuthorityPort;
  execution: E2EExecutionPort;
  session: E2ESessionPort;
  requiredChecks: E2ERequiredChecksPort;
  createVerificationRunId(attempt: number): string;
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
  previousConversationIds: readonly string[];
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
  stageResult: LoopStageResult;
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
  pendingCleanup?: unknown;
  lastWorkspaceDestroyed?: boolean;
  sessionAttempts: LoopSessionAttempt[];
  stageResult: LoopStageResult;
};

type NormalizedInput = RunCleanRoomE2EGateInput & {
  featureTarget: LoopSessionTarget;
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

export class CleanRoomE2EGate {
  constructor(private readonly dependencies: CleanRoomE2EGateDependencies) {}

  async run(
    rawInput: RunCleanRoomE2EGateInput
  ): Promise<Result<CleanRoomE2EGateOutput, CleanRoomE2EGateError>> {
    const normalized = normalizeInput(rawInput);
    if (!normalized.success) {
      return err(
        this.failure(rawInput, normalized.error.type, 'precondition', normalized.error.message, {
          featureHead: validCommit(rawInput.checkpointCommit) ? rawInput.checkpointCommit : '',
          attempt: 0,
          sessionAttempts: [],
        })
      );
    }
    const input = normalized.data;
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

    for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
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

      const verificationRunId = this.dependencies.createVerificationRunId(attempt);
      if (!validId(verificationRunId) || verificationRunIds.includes(verificationRunId)) {
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

      const created = await this.dependencies.cleanRoom.create({
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
      });
      if (!created.success) {
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
        const destroyed = await this.destroyOnly(
          input,
          cleanRoom,
          featureHead,
          attempt,
          sessionAttempts
        );
        if (!destroyed.success) return destroyed;
        return err(
          this.failure(input, cleanRoomError.type, 'create', cleanRoomError.message, {
            featureHead,
            attempt,
            verificationRunId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }

      const acquired = await this.dependencies.execution.acquire({
        cleanRoom,
        task: input.task,
        project: input.project,
        signal: input.signal,
        deadlineAt: input.deadlineAt,
      });
      if (!acquired.success) {
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

      const begun = await this.dependencies.authority.beginAttempt({
        cleanRoom,
        target: copyTarget(cleanRoom.target),
        expectedFeatureHead: featureHead,
        signal: input.signal,
        deadlineAt: input.deadlineAt,
      });
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

      const startedAt = this.dependencies.now().toISOString();
      const started = await this.dependencies.session.startFreshE2ESession({
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
      });
      if (!started.success) {
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
            { verificationRunId, lastWorkspaceDestroyed: true }
          )
        );
      }
      const sessionError = validateSession(
        started.data,
        cleanRoom.target,
        binding.taskEnvironment,
        input,
        verificationRunId,
        attempt,
        sessionAttempts
      );
      if (sessionError) {
        const cancelled = await this.cancelSession(started.data);
        if (!cancelled.success) {
          return err(
            this.dependencyFailure(
              input,
              cancelled.error,
              'quiescence',
              featureHead,
              attempt,
              sessionAttempts,
              { verificationRunId, recoveryRequired: true }
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
          this.failure(input, sessionError.type, 'session-start', sessionError.message, {
            featureHead,
            attempt,
            verificationRunId,
            conversationId: started.data.conversationId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }

      const session = started.data;
      const outerLedgerIndex =
        sessionAttempts.push(makeOuterAttempt(input, session, featureHead, startedAt)) - 1;
      const active: ActiveAttempt = {
        number: attempt,
        verificationRunId,
        cleanRoom,
        binding,
        authority: begun.data,
        session,
        outerLedgerIndex,
      };

      const prompt = buildE2EPrompt({
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
      const prompted = await this.dependencies.session.sendE2EPrompt({
        attemptId: session.attemptId,
        conversationId: session.conversationId,
        verificationRunId,
        attempt,
        target: copyTarget(cleanRoom.target),
        prompt,
        signal: input.signal,
        deadlineAt: input.deadlineAt,
      });

      const cancelled = await this.cancelSession(session);
      if (!cancelled.success) {
        markOuterAttempt(
          sessionAttempts,
          outerLedgerIndex,
          'interrupted',
          this.dependencies.now(),
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
            { verificationRunId, conversationId: session.conversationId, recoveryRequired: true }
          )
        );
      }
      if (!prompted.success) {
        markOuterAttempt(sessionAttempts, outerLedgerIndex, 'failed', this.dependencies.now(), {
          error: prompted.error.message,
        });
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
        markOuterAttempt(sessionAttempts, outerLedgerIndex, 'failed', this.dependencies.now(), {
          error: promptEcho.message,
        });
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

      const inspected = await this.dependencies.authority.inspectAttempt({
        cleanRoom,
        target: copyTarget(cleanRoom.target),
        expectedFeatureHead: featureHead,
        mutationBaseline: begun.data.mutationBaseline,
        signal: input.signal,
        deadlineAt: input.deadlineAt,
      });
      if (!inspected.success) {
        markOuterAttempt(sessionAttempts, outerLedgerIndex, 'failed', this.dependencies.now(), {
          error: inspected.error.message,
        });
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
        markOuterAttempt(sessionAttempts, outerLedgerIndex, 'failed', this.dependencies.now(), {
          error: inspectionError.message,
        });
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
      const sentinel = parseE2ESentinel(prompted.data.finalText);
      if (!sentinel) {
        markOuterAttempt(sessionAttempts, outerLedgerIndex, 'failed', this.dependencies.now(), {
          error: 'Malformed E2E sentinel.',
        });
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
        markOuterAttempt(sessionAttempts, outerLedgerIndex, 'failed', this.dependencies.now(), {
          error: sentinel.reason,
        });
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
          markOuterAttempt(sessionAttempts, outerLedgerIndex, 'failed', this.dependencies.now(), {
            error: correctionError.message,
          });
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
        const previousFeatureHead = featureHead;
        const integrated = await this.dependencies.cleanRoom.integrateFix({
          cleanRoom,
          featureTarget: copyTarget(input.featureTarget),
          expectedFeatureHead: previousFeatureHead,
          fixCommit: inspected.data.headCommit,
          project: input.project,
          signal: input.signal,
          timeoutMs: remainingTimeout(input),
        });
        if (!integrated.success) {
          markOuterAttempt(sessionAttempts, outerLedgerIndex, 'failed', this.dependencies.now(), {
            error: integrated.error.message,
          });
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
                lastWorkspaceDestroyed: true,
              }
            )
          );
        }
        if (!validCommit(integrated.data.featureHead)) {
          markOuterAttempt(sessionAttempts, outerLedgerIndex, 'failed', this.dependencies.now(), {
            error: 'Fix integration returned invalid head authority.',
          });
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
                sessionAttempts,
              }
            )
          );
        }
        featureHead = integrated.data.featureHead;
        correctionCount += 1;
        markOuterAttempt(sessionAttempts, outerLedgerIndex, 'completed', this.dependencies.now(), {
          checkpointAfter: featureHead,
        });
        const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
        if (!cleanup.success) return cleanup;
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
        markOuterAttempt(sessionAttempts, outerLedgerIndex, 'failed', this.dependencies.now(), {
          error: candidateError.message,
        });
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

      const checked = await this.dependencies.requiredChecks.run({
        verificationRunId,
        attempt,
        conversationId: session.conversationId,
        target: copyTarget(cleanRoom.target),
        executionTarget: binding.executionTarget,
        taskEnvironment: copyEnvironment(binding.taskEnvironment),
        checkpointCommit: featureHead,
        provider: input.provider,
        model: input.model,
        signal: input.signal,
        deadlineAt: input.deadlineAt,
      });
      if (!checked.success) {
        markOuterAttempt(sessionAttempts, outerLedgerIndex, 'failed', this.dependencies.now(), {
          error: checked.error.message,
        });
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
        sessionAttempts
      );
      if (checksError) {
        markOuterAttempt(sessionAttempts, outerLedgerIndex, 'failed', this.dependencies.now(), {
          error: checksError.message,
        });
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
      sessionAttempts.push(...checked.data.sessionAttempts.map(copyAttempt));

      const postChecks = await this.dependencies.authority.inspectAttempt({
        cleanRoom,
        target: copyTarget(cleanRoom.target),
        expectedFeatureHead: featureHead,
        mutationBaseline: begun.data.mutationBaseline,
        signal: input.signal,
        deadlineAt: input.deadlineAt,
      });
      if (!postChecks.success) {
        markOuterAttempt(sessionAttempts, outerLedgerIndex, 'failed', this.dependencies.now(), {
          error: postChecks.error.message,
        });
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
        markOuterAttempt(sessionAttempts, outerLedgerIndex, 'failed', this.dependencies.now(), {
          error: postChecksError.message,
        });
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

      markOuterAttempt(sessionAttempts, outerLedgerIndex, 'completed', this.dependencies.now(), {
        checkpointAfter: featureHead,
      });
      const cleanup = await this.cleanupActive(input, active, featureHead, sessionAttempts);
      if (!cleanup.success) return cleanup;

      if (checked.data.status === 'correctable') {
        intermediateFailures.push(checked.data.handoff!);
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

      const finalFeature = await this.dependencies.authority.inspectFeature({
        target: copyTarget(input.featureTarget),
        expectedFeatureHead: featureHead,
        signal: input.signal,
        deadlineAt: input.deadlineAt,
      });
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
              lastWorkspaceDestroyed: true,
            }
          )
        );
      }
      const finalError = validateFeature(finalFeature.data, input.featureTarget, featureHead);
      if (finalError) {
        return err(
          this.failure(input, finalError.type, 'finalize', finalError.message, {
            featureHead,
            attempt,
            verificationRunId,
            conversationId: session.conversationId,
            lastWorkspaceDestroyed: true,
            sessionAttempts,
          })
        );
      }
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

  private async cancelSession(
    session: E2ESessionInfo
  ): Promise<Result<void, E2EGateDependencyError>> {
    const cancelled = await this.dependencies.session.cancelE2ESession({
      attemptId: session.attemptId,
      conversationId: session.conversationId,
      verificationRunId: session.verificationRunId,
      attempt: session.attempt,
      target: copyTarget(session.target),
    });
    if (!cancelled.success) return cancelled;
    const value = cancelled.data;
    if (
      value.quiescent !== true ||
      value.attemptId !== session.attemptId ||
      value.conversationId !== session.conversationId ||
      value.verificationRunId !== session.verificationRunId ||
      value.attempt !== session.attempt ||
      !sameTarget(value.target, session.target)
    ) {
      return err({ message: 'E2E cancellation returned invalid quiescence authority.' });
    }
    return ok();
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
    const released = await this.dependencies.execution.release({
      target: copyTarget(binding.target),
      executionTarget: binding.executionTarget,
    });
    if (!released.success) {
      return err(
        this.dependencyFailure(
          input,
          released.error,
          'cleanup',
          featureHead,
          attempt,
          sessionAttempts,
          { recoveryRequired: true, lastWorkspaceDestroyed: false }
        )
      );
    }
    if (released.data.released !== true || !sameTarget(released.data.target, binding.target)) {
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
            sessionAttempts,
          }
        )
      );
    }
    return this.destroyOnly(input, cleanRoom, featureHead, attempt, sessionAttempts);
  }

  private async destroyOnly(
    input: NormalizedInput,
    cleanRoom: CleanRoomWorkspace,
    featureHead: string,
    attempt: number,
    sessionAttempts: LoopSessionAttempt[]
  ): Promise<CleanupResult> {
    const destroyed = await this.dependencies.cleanRoom.destroy(cleanRoom, input.project);
    if (!destroyed.success) {
      return err(
        this.dependencyFailure(
          input,
          destroyed.error,
          'cleanup',
          featureHead,
          attempt,
          sessionAttempts,
          { recoveryRequired: true, lastWorkspaceDestroyed: false }
        )
      );
    }
    return ok();
  }

  private dependencyFailure(
    input: RunCleanRoomE2EGateInput,
    dependencyError: E2EGateDependencyError,
    stage: CleanRoomE2EGateStage,
    featureHead: string,
    attempt: number,
    sessionAttempts: LoopSessionAttempt[],
    extra: Partial<CleanRoomE2EGateError> = {}
  ): CleanRoomE2EGateError {
    const type =
      stage === 'cleanup'
        ? 'cleanup-failed'
        : dependencyError.type === 'cancelled' || dependencyError.kind === 'cancelled'
          ? 'cancelled'
          : dependencyError.type === 'deadline-exceeded' ||
              dependencyError.kind === 'deadline-exceeded'
            ? 'deadline-exceeded'
            : 'dependency-rejected';
    return this.failure(input, type, stage, dependencyError.message, {
      featureHead,
      attempt,
      sessionAttempts,
      ...(dependencyError.pendingCleanup !== undefined
        ? { pendingCleanup: dependencyError.pendingCleanup }
        : {}),
      ...extra,
    });
  }

  private failure(
    input: Pick<RunCleanRoomE2EGateInput, 'signal'>,
    type: string,
    stage: CleanRoomE2EGateStage,
    message: string,
    fields: Pick<CleanRoomE2EGateError, 'featureHead' | 'attempt' | 'sessionAttempts'> &
      Partial<CleanRoomE2EGateError>
  ): CleanRoomE2EGateError {
    const status = type === 'cancelled' ? 'cancelled' : 'failed';
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
      ...(fields.lastWorkspaceDestroyed !== undefined
        ? { lastWorkspaceDestroyed: fields.lastWorkspaceDestroyed }
        : {}),
      sessionAttempts: fields.sessionAttempts.map(copyAttempt),
      stageResult: this.stageResult(
        status,
        status === 'cancelled' ? 'Clean-room E2E was cancelled.' : message
      ),
    };
  }

  private stageResult(status: 'passed' | 'failed' | 'cancelled', summary: string): LoopStageResult {
    return loopStageResultSchema.parse({
      status,
      summary: boundedSummary(summary, 'Clean-room E2E completed.'),
      completedAt: this.dependencies.now().toISOString(),
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
    }).success
  ) {
    return err({ type: 'invalid-input', message: 'Invalid bounded E2E prompt context.' });
  }
  const target = loopSessionTargetSchema.safeParse(input.featureTarget);
  if (!target.success) {
    return err({ type: 'invalid-input', message: 'Invalid feature execution target.' });
  }
  if (!loopProviderSchema.safeParse(input.provider).success) {
    return err({ type: 'invalid-input', message: 'Invalid E2E provider.' });
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
  if (
    input.previousConversationIds.length > 1_024 ||
    input.previousConversationIds.some((id) => !validId(id)) ||
    new Set(input.previousConversationIds).size !== input.previousConversationIds.length
  ) {
    return err({ type: 'invalid-input', message: 'Invalid previous conversation ledger.' });
  }
  if (
    input.intermediateFailures.length > 64 ||
    input.intermediateFailures.some(
      (handoff) => !loopPromptHandoffSchema.safeParse(handoff).success
    )
  ) {
    return err({ type: 'invalid-input', message: 'Invalid intermediate E2E failure handoff.' });
  }
  if (
    input.deadlineAt !== undefined &&
    (!Number.isFinite(input.deadlineAt) || input.deadlineAt < 0)
  ) {
    return err({ type: 'invalid-input', message: 'Invalid E2E deadline.' });
  }
  return ok({ ...input, model: input.model.trim(), featureTarget: target.data });
}

function terminalPrecondition(
  input: NormalizedInput
): { type: string; message: string } | undefined {
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
  if (
    cleanRoom.projectId !== input.project.projectId ||
    cleanRoom.verificationRunId !== verificationRunId ||
    cleanRoom.attempt !== attempt ||
    cleanRoom.baseCommit !== input.baseCommit ||
    cleanRoom.expectedFeatureHead !== featureHead ||
    cleanRoom.replayedThroughCommit !== featureHead ||
    !validId(cleanRoom.cleanupId) ||
    !validId(cleanRoom.branchName) ||
    !loopSessionTargetSchema.safeParse(cleanRoom.target).success
  ) {
    return {
      type: 'clean-room-authority-invalid',
      message: 'Clean-room identity attestation is invalid.',
    };
  }
  if (!sameMachine(cleanRoom.target, input.featureTarget)) {
    return { type: 'target-drift', message: 'Clean room was created on a different machine.' };
  }
  return undefined;
}

function validateBinding(
  binding: E2EExecutionBinding,
  target: LoopSessionTarget,
  input: NormalizedInput
): { type: string; message: string } | undefined {
  if (
    !sameTarget(binding.target, target) ||
    !sameTarget(binding.executionTarget, target) ||
    !sameEnvironment(binding.executionTarget.taskEnv, binding.taskEnvironment)
  ) {
    return {
      type: 'execution-target-drift',
      message: 'Execution binding drifted from the clean room.',
    };
  }
  const keys = Object.keys(binding.taskEnvironment).sort();
  if (
    keys.length !== TRUSTED_TASK_ENVIRONMENT_KEYS.length ||
    TRUSTED_TASK_ENVIRONMENT_KEYS.some((key) => !keys.includes(key)) ||
    Object.values(binding.taskEnvironment).some((value) => typeof value !== 'string') ||
    binding.taskEnvironment.EMDASH_TASK_ID !== input.task.id ||
    binding.taskEnvironment.EMDASH_TASK_PATH !== target.path ||
    binding.taskEnvironment.EMDASH_ROOT_PATH !== input.project.repoPath
  ) {
    return {
      type: 'task-environment-invalid',
      message: 'Trusted task environment is not the exact six-key overlay.',
    };
  }
  return undefined;
}

function validateBeginning(
  authority: E2EAttemptAuthority,
  target: LoopSessionTarget,
  featureHead: string
): { type: string; message: string } | undefined {
  if (!sameTarget(authority.target, target) || !validId(authority.mutationBaseline)) {
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
  attempts: readonly LoopSessionAttempt[]
): { type: string; message: string } | undefined {
  if (!validId(session.attemptId) || !validId(session.conversationId)) {
    return { type: 'session-authority-invalid', message: 'Fresh E2E session IDs are invalid.' };
  }
  if (
    session.verificationRunId !== verificationRunId ||
    session.attempt !== attempt ||
    session.provider !== input.provider ||
    session.model !== input.model ||
    !sameTarget(session.target, target) ||
    !sameEnvironment(session.taskEnvironment, taskEnvironment)
  ) {
    return { type: 'session-authority-invalid', message: 'Fresh E2E session attestation drifted.' };
  }
  if (
    input.previousConversationIds.includes(session.conversationId) ||
    attempts.some(
      (item) =>
        item.conversationId === session.conversationId || item.attemptId === session.attemptId
    )
  ) {
    return { type: 'stale-conversation', message: 'Fresh E2E session reused prior identity.' };
  }
  return undefined;
}

function validatePromptResult(
  value: {
    conversationId: string;
    verificationRunId: string;
    attempt: number;
    target: LoopSessionTarget;
    finalText: string;
  },
  session: E2ESessionInfo
): { type: string; message: string } | undefined {
  if (
    value.conversationId !== session.conversationId ||
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

function validateRequiredChecks(
  checks: E2ERequiredChecksResult,
  active: ActiveAttempt,
  featureHead: string,
  input: NormalizedInput,
  existingAttempts: readonly LoopSessionAttempt[]
): { type: string; message: string } | undefined {
  if (
    checks.verificationRunId !== active.verificationRunId ||
    checks.attempt !== active.number ||
    checks.outerConversationId !== active.session.conversationId ||
    !sameTarget(checks.target, active.cleanRoom.target) ||
    !sameTarget(checks.executionTarget, active.cleanRoom.target) ||
    checks.checkpointCommit !== featureHead ||
    checks.provider !== input.provider ||
    checks.model !== input.model ||
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
    if (!checks.handoff || !loopPromptHandoffSchema.safeParse(checks.handoff).success) {
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
  if (checks.sessionAttempts.length === 0) {
    return {
      type: 'native-verifier-authority-invalid',
      message: 'Native verifier attempt ledger is missing.',
    };
  }
  const seenAttempts = new Set(existingAttempts.map((item) => item.attemptId));
  const seenConversations = new Set(existingAttempts.map((item) => item.conversationId));
  for (const candidate of checks.sessionAttempts) {
    const parsed = loopSessionAttemptSchema.safeParse(candidate);
    if (
      !parsed.success ||
      parsed.data.purpose !== 'browser-verification' ||
      parsed.data.verificationRunId !== active.verificationRunId ||
      !sameTarget(parsed.data.target, active.cleanRoom.target) ||
      parsed.data.conversationId === active.session.conversationId ||
      seenAttempts.has(parsed.data.attemptId) ||
      seenConversations.has(parsed.data.conversationId)
    ) {
      return {
        type: 'native-verifier-ledger-invalid',
        message: 'Native verifier ledger is not fresh and target-bound.',
      };
    }
    seenAttempts.add(parsed.data.attemptId);
    seenConversations.add(parsed.data.conversationId);
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

function makeOuterAttempt(
  input: NormalizedInput,
  session: E2ESessionInfo,
  checkpoint: string,
  startedAt: string
): LoopSessionAttempt {
  return loopSessionAttemptSchema.parse({
    attemptId: session.attemptId,
    conversationId: session.conversationId,
    purpose: 'e2e',
    phaseId: input.phase.id,
    verificationRunId: session.verificationRunId,
    target: copyTarget(session.target),
    status: 'running',
    checkpointBefore: checkpoint,
    startedAt,
  });
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
  return loopSessionAttemptSchema.parse(attempt);
}

function copyTarget(target: LoopSessionTarget): LoopSessionTarget {
  return loopSessionTargetSchema.parse(target);
}

function copyEnvironment(
  environment: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  return Object.freeze({ ...environment });
}

function sameEnvironment(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
  );
}

function sameTarget(left: LoopSessionTarget, right: LoopSessionTarget): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.path === right.path &&
    left.machine.kind === right.machine.kind &&
    (left.machine.kind === 'local' ||
      (right.machine.kind === 'ssh' && left.machine.connectionId === right.machine.connectionId))
  );
}

function sameMachine(left: LoopSessionTarget, right: LoopSessionTarget): boolean {
  return (
    left.machine.kind === right.machine.kind &&
    (left.machine.kind === 'local' ||
      (right.machine.kind === 'ssh' && left.machine.connectionId === right.machine.connectionId))
  );
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ID_LENGTH;
}

function validCommit(value: unknown): value is string {
  return loopCommitSchema.safeParse(value).success;
}

function boundedSummary(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return (trimmed || fallback).slice(0, MAX_SUMMARY_LENGTH);
}

function controlFailure(
  input: Pick<RunCleanRoomE2EGateInput, 'signal' | 'deadlineAt'>
): { type: 'cancelled' | 'deadline-exceeded'; message: string } | undefined {
  if (input.signal?.aborted) return { type: 'cancelled', message: 'Clean-room E2E was cancelled.' };
  if (input.deadlineAt !== undefined && Date.now() >= input.deadlineAt) {
    return { type: 'deadline-exceeded', message: 'Clean-room E2E deadline was exceeded.' };
  }
  return undefined;
}

function remainingTimeout(input: Pick<RunCleanRoomE2EGateInput, 'deadlineAt'>): number | undefined {
  if (input.deadlineAt === undefined) return undefined;
  return Math.max(1, Math.min(2_147_483_647, input.deadlineAt - Date.now()));
}
