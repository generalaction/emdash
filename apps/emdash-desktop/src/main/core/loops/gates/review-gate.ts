import { err, ok, type Result } from '@main/lib/result';
import { loopStageResultSchema, type LoopStageResult } from '@shared/core/loops/loop-phase-state';
import {
  loopCommitSchema,
  loopSessionTargetSchema,
  type LoopSessionTarget,
} from '@shared/core/loops/loop-state';
import { loopProviderSchema, type LoopProviderId } from '@shared/core/loops/loops';
import { loopPromptContextInputSchema, type LoopPromptContextInput } from '../handoff-builder';
import { buildTerminalReviewPrompt, parseTerminalReviewSentinel } from '../terminal-review-prompt';

const MAX_CONVERSATION_IDS = 1_024;
const MAX_CONVERSATION_ID_LENGTH = 256;
const MAX_MODEL_LENGTH = 256;
const MAX_STAGE_SUMMARY_LENGTH = 16_384;

export type ReviewGateDependencyError = {
  type: string;
  message: string;
};

export type ReviewWorkspaceOperationInput = {
  target: LoopSessionTarget;
  baseCommit: string;
  checkpointCommit: string;
  signal?: AbortSignal;
  deadlineAt?: number;
};

export type ReviewWorkspaceSnapshot = {
  target: LoopSessionTarget;
  headCommit: string;
  clean: boolean;
};

export type ReviewCheckpointRangeValidation = {
  target: LoopSessionTarget;
  baseCommit: string;
  checkpointCommit: string;
  linear: boolean;
  loopOwned: boolean;
};

export type ReviewCorrectionValidation = {
  target: LoopSessionTarget;
  baseCommit: string;
  previousCheckpointCommit: string;
  checkpointCommit: string;
  parentCommit: string;
  commitCount: number;
  linear: boolean;
  loopOwned: boolean;
};

export type ValidateReviewCorrectionInput = ReviewWorkspaceOperationInput & {
  previousCheckpointCommit: string;
};

export type StartFreshReviewSessionInput = ReviewWorkspaceOperationInput & {
  purpose: 'review';
  provider: LoopProviderId;
  model: string;
};

export type ReviewSessionInfo = {
  conversationId: string;
  target: LoopSessionTarget;
};

export type SendReviewPromptInput = {
  conversationId: string;
  target: LoopSessionTarget;
  prompt: string;
  signal?: AbortSignal;
  deadlineAt?: number;
};

export type CancelReviewSessionInput = {
  conversationId: string;
  target: LoopSessionTarget;
};

export type ReviewRequiredGateResult = {
  target: LoopSessionTarget;
  checkpointCommit: string;
  summary: string;
};

export interface ReviewSessionPort {
  /** Starts a newly allocated conversation and never hydrates or reuses an earlier session. */
  startFreshReviewSession(
    input: StartFreshReviewSessionInput
  ): Promise<Result<ReviewSessionInfo, ReviewGateDependencyError>>;
  sendReviewPrompt(
    input: SendReviewPromptInput
  ): Promise<Result<{ finalText: string }, ReviewGateDependencyError>>;
  cancelReviewSession(input: CancelReviewSessionInput): void | Promise<void>;
}

export interface ReviewCheckpointPort {
  inspectWorkspace(
    input: ReviewWorkspaceOperationInput
  ): Promise<Result<ReviewWorkspaceSnapshot, ReviewGateDependencyError>>;
  validateCheckpointRange(
    input: ReviewWorkspaceOperationInput
  ): Promise<Result<ReviewCheckpointRangeValidation, ReviewGateDependencyError>>;
  validateCorrection(
    input: ValidateReviewCorrectionInput
  ): Promise<Result<ReviewCorrectionValidation, ReviewGateDependencyError>>;
}

export interface ReviewRequiredGatePort {
  run(
    input: ReviewWorkspaceOperationInput
  ): Promise<Result<ReviewRequiredGateResult, ReviewGateDependencyError>>;
}

export type ReviewGateDependencies = {
  session: ReviewSessionPort;
  checkpoint: ReviewCheckpointPort;
  requiredGate: ReviewRequiredGatePort;
  now(): Date;
};

export type RunTerminalReviewGateInput = LoopPromptContextInput & {
  target: LoopSessionTarget;
  provider: LoopProviderId;
  model: string;
  workPhaseResults: readonly LoopStageResult[];
  previousConversationIds: readonly string[];
  signal?: AbortSignal;
  deadlineAt?: number;
};

export type ReviewGateOutput = {
  purpose: 'review';
  conversationId: string;
  target: LoopSessionTarget;
  previousCheckpointCommit: string;
  checkpointCommit: string;
  correctionApplied: boolean;
  requiredGateSummary: string;
  stageResult: LoopStageResult;
};

export type ReviewGateErrorType =
  | 'invalid-input'
  | 'work-phases-incomplete'
  | 'cancelled'
  | 'deadline-exceeded'
  | 'dependency-rejected'
  | 'target-drift'
  | 'checkpoint-drift'
  | 'dirty-workspace'
  | 'non-linear-checkpoint'
  | 'unowned-checkpoint'
  | 'correction-count'
  | 'stale-conversation'
  | 'malformed-sentinel'
  | 'review-failed'
  | 'required-gate-failed';

export type ReviewGateStage =
  | 'precondition'
  | 'preflight'
  | 'session-start'
  | 'prompt'
  | 'post-review'
  | 'correction'
  | 'required-gate'
  | 'finalize';

export type ReviewGateError = {
  type: ReviewGateErrorType;
  stage: ReviewGateStage;
  message: string;
  checkpointCommit: string;
  conversationId?: string;
  stageResult: LoopStageResult;
};

type NormalizedReviewGateInput = Omit<RunTerminalReviewGateInput, 'target'> & {
  target: LoopSessionTarget;
  reviewPrompt: string;
};

type ControlFailure = {
  type: 'cancelled' | 'deadline-exceeded';
  message: string;
};

type DependencyFailure =
  | ControlFailure
  | {
      type: 'dependency-rejected';
      message: string;
    };

type ControlledOutcome<T> =
  | { kind: 'completed'; value: Result<T, ReviewGateDependencyError> }
  | { kind: 'thrown'; cause: unknown }
  | { kind: 'stopped'; failure: ControlFailure };

type ReviewRunCancellation = {
  authoritativeTarget: LoopSessionTarget;
  conversationIds: Set<string>;
};

export class TerminalReviewGate {
  constructor(private readonly dependencies: ReviewGateDependencies) {}

  async run(
    rawInput: RunTerminalReviewGateInput
  ): Promise<Result<ReviewGateOutput, ReviewGateError>> {
    const parsedInput = normalizeInput(rawInput);
    if (!parsedInput.success) {
      return this.fail(
        'invalid-input',
        'precondition',
        parsedInput.error,
        validCommitOrEmpty(rawInput.checkpointCommit)
      );
    }
    const input = parsedInput.data;
    const cancellation: ReviewRunCancellation = {
      authoritativeTarget: input.target,
      conversationIds: new Set<string>(),
    };
    let acceptedCheckpoint = input.checkpointCommit;

    const stopped = controlFailure(input);
    if (stopped) return this.controlFail(stopped, 'precondition', acceptedCheckpoint);

    if (
      input.workPhaseResults.length === 0 ||
      input.workPhaseResults.some((result) => result.status !== 'passed')
    ) {
      return this.fail(
        'work-phases-incomplete',
        'precondition',
        'Terminal Review can start only after every work phase has passed.',
        acceptedCheckpoint
      );
    }

    const preflight = await this.inspectWorkspace(input, acceptedCheckpoint, 'preflight');
    if (!preflight.success) return err(this.withCheckpoint(preflight.error, acceptedCheckpoint));
    const preflightAuthority = validateSnapshot(
      preflight.data,
      input.target,
      acceptedCheckpoint,
      true
    );
    if (preflightAuthority) {
      return this.fail(
        preflightAuthority.type,
        'preflight',
        preflightAuthority.message,
        acceptedCheckpoint
      );
    }

    const range = await this.callDependency(input, 'Checkpoint range validation', () =>
      this.dependencies.checkpoint.validateCheckpointRange(
        workspaceInput(input, acceptedCheckpoint)
      )
    );
    if (!range.success) {
      return this.dependencyFail(range.error, 'preflight', acceptedCheckpoint);
    }
    const rangeAuthority = validateRange(
      range.data,
      input.target,
      input.baseCommit,
      acceptedCheckpoint
    );
    if (rangeAuthority) {
      return this.fail(
        rangeAuthority.type,
        'preflight',
        rangeAuthority.message,
        acceptedCheckpoint
      );
    }

    const started = await this.callDependency(
      input,
      'Fresh Review session start',
      () =>
        this.dependencies.session.startFreshReviewSession({
          ...workspaceInput(input, acceptedCheckpoint),
          purpose: 'review',
          provider: input.provider,
          model: input.model,
        }),
      (lateSession) => this.cancelSession(lateSession, cancellation)
    );
    if (!started.success) {
      return this.dependencyFail(started.error, 'session-start', acceptedCheckpoint);
    }
    if (!isReviewSessionInfo(started.data)) {
      this.cancelSession(started.data, cancellation);
      return this.fail(
        'dependency-rejected',
        'session-start',
        'Fresh Review session start returned invalid session metadata.',
        acceptedCheckpoint
      );
    }
    const session = started.data;

    if (!validConversationId(session.conversationId)) {
      this.cancelSession(session, cancellation);
      return this.fail(
        'dependency-rejected',
        'session-start',
        'Fresh Review session start returned an invalid conversation ID.',
        acceptedCheckpoint
      );
    }
    if (!sameTarget(session.target, input.target)) {
      this.cancelSession(session, cancellation);
      return this.fail(
        'target-drift',
        'session-start',
        'The Review session was bound to a different workspace target.',
        acceptedCheckpoint,
        session.conversationId
      );
    }
    if (input.previousConversationIds.includes(session.conversationId)) {
      this.cancelSession(session, cancellation);
      return this.fail(
        'stale-conversation',
        'session-start',
        'The Review session reused an earlier Loop conversation.',
        acceptedCheckpoint,
        session.conversationId
      );
    }

    const promptResult = await this.callDependency(input, 'Review prompt', () =>
      this.dependencies.session.sendReviewPrompt({
        conversationId: session?.conversationId ?? '',
        target: copyTarget(input.target),
        prompt: input.reviewPrompt,
        signal: input.signal,
        deadlineAt: input.deadlineAt,
      })
    );
    if (!promptResult.success) {
      this.cancelSession(session, cancellation);
      return this.dependencyFail(
        promptResult.error,
        'prompt',
        acceptedCheckpoint,
        session.conversationId
      );
    }

    const postReview = await this.inspectWorkspace(input, acceptedCheckpoint, 'post-review');
    if (!postReview.success) {
      this.cancelIfStopped(session, postReview.error, cancellation);
      return err(
        this.withConversation(
          this.withCheckpoint(postReview.error, acceptedCheckpoint),
          session.conversationId
        )
      );
    }
    const postReviewAuthority = validateSnapshot(postReview.data, input.target, undefined, true);
    if (postReviewAuthority) {
      return this.fail(
        postReviewAuthority.type,
        'post-review',
        postReviewAuthority.message,
        acceptedCheckpoint,
        session.conversationId
      );
    }

    if (typeof promptResult.data.finalText !== 'string') {
      return this.fail(
        'malformed-sentinel',
        'prompt',
        'The terminal Review response was not text.',
        acceptedCheckpoint,
        session.conversationId
      );
    }
    const sentinel = parseTerminalReviewSentinel(promptResult.data.finalText);
    if (!sentinel) {
      return this.fail(
        'malformed-sentinel',
        'prompt',
        'The terminal Review response contained a missing, malformed, or conflicting sentinel.',
        acceptedCheckpoint,
        session.conversationId
      );
    }
    if (sentinel.kind === 'failed') {
      return this.fail(
        'review-failed',
        'prompt',
        sentinel.reason,
        acceptedCheckpoint,
        session.conversationId,
        `Terminal Review failed: ${sentinel.reason}`
      );
    }

    const reviewedHead = normalizeCommit(postReview.data.headCommit);
    let correctionApplied = false;
    if (!sameCommit(reviewedHead, acceptedCheckpoint)) {
      const previousCheckpoint = acceptedCheckpoint;
      const correction = await this.callDependency(input, 'Review correction validation', () =>
        this.dependencies.checkpoint.validateCorrection({
          ...workspaceInput(input, reviewedHead),
          previousCheckpointCommit: previousCheckpoint,
        })
      );
      if (!correction.success) {
        if (
          correction.error.type === 'cancelled' ||
          correction.error.type === 'deadline-exceeded'
        ) {
          this.cancelSession(session, cancellation);
        }
        return this.dependencyFail(
          correction.error,
          'correction',
          acceptedCheckpoint,
          session.conversationId
        );
      }
      const correctionAuthority = validateCorrection(
        correction.data,
        input.target,
        input.baseCommit,
        previousCheckpoint,
        reviewedHead
      );
      if (correctionAuthority) {
        return this.fail(
          correctionAuthority.type,
          'correction',
          correctionAuthority.message,
          acceptedCheckpoint,
          session.conversationId
        );
      }
      acceptedCheckpoint = reviewedHead;
      correctionApplied = true;
    }

    const requiredGate = await this.callDependency(input, 'Required gate rerun', () =>
      this.dependencies.requiredGate.run(workspaceInput(input, acceptedCheckpoint))
    );
    if (!requiredGate.success) {
      if (
        requiredGate.error.type === 'cancelled' ||
        requiredGate.error.type === 'deadline-exceeded'
      ) {
        this.cancelSession(session, cancellation);
        return this.controlFail(
          requiredGate.error,
          'required-gate',
          acceptedCheckpoint,
          session.conversationId
        );
      }
      return this.fail(
        'required-gate-failed',
        'required-gate',
        requiredGate.error.message,
        acceptedCheckpoint,
        session.conversationId
      );
    }
    const gateAuthority = validateRequiredGate(requiredGate.data, input.target, acceptedCheckpoint);
    if (gateAuthority) {
      return this.fail(
        gateAuthority.type,
        'required-gate',
        gateAuthority.message,
        acceptedCheckpoint,
        session.conversationId
      );
    }

    const finalWorkspace = await this.inspectWorkspace(input, acceptedCheckpoint, 'finalize');
    if (!finalWorkspace.success) {
      this.cancelIfStopped(session, finalWorkspace.error, cancellation);
      return err(
        this.withConversation(
          this.withCheckpoint(finalWorkspace.error, acceptedCheckpoint),
          session.conversationId
        )
      );
    }
    const finalAuthority = validateSnapshot(
      finalWorkspace.data,
      input.target,
      acceptedCheckpoint,
      true
    );
    if (finalAuthority) {
      return this.fail(
        finalAuthority.type,
        'finalize',
        finalAuthority.message,
        acceptedCheckpoint,
        session.conversationId
      );
    }

    const stageResult = this.stageResult(
      'passed',
      correctionApplied
        ? 'Terminal Review and required gate passed with one correction checkpoint.'
        : 'Terminal Review and required gate passed without a correction checkpoint.'
    );
    return ok({
      purpose: 'review',
      conversationId: session.conversationId,
      target: copyTarget(input.target),
      previousCheckpointCommit: input.checkpointCommit,
      checkpointCommit: acceptedCheckpoint,
      correctionApplied,
      requiredGateSummary: boundedSummary(requiredGate.data.summary, 'Required gate passed.'),
      stageResult,
    });
  }

  private async inspectWorkspace(
    input: NormalizedReviewGateInput,
    checkpointCommit: string,
    stage: ReviewGateStage
  ): Promise<Result<ReviewWorkspaceSnapshot, ReviewGateError>> {
    const inspected = await this.callDependency(input, 'Workspace inspection', () =>
      this.dependencies.checkpoint.inspectWorkspace(workspaceInput(input, checkpointCommit))
    );
    if (inspected.success) return inspected;
    return this.dependencyFail(inspected.error, stage, checkpointCommit);
  }

  private async callDependency<T>(
    input: NormalizedReviewGateInput,
    label: string,
    operation: () => Promise<Result<T, ReviewGateDependencyError>>,
    onLateSuccess?: (value: T) => void
  ): Promise<Result<T, DependencyFailure>> {
    const stopped = controlFailure(input);
    if (stopped) return err(stopped);

    let operationPromise: Promise<ControlledOutcome<T>>;
    try {
      operationPromise = Promise.resolve(operation()).then(
        (value) => ({ kind: 'completed', value }),
        (cause) => ({ kind: 'thrown', cause })
      );
    } catch (cause) {
      return err({
        type: 'dependency-rejected',
        message: `${label} failed: ${errorMessage(cause)}`,
      });
    }

    const controlled = await raceWithControl(operationPromise, input);
    if (controlled.kind === 'stopped') {
      void operationPromise.then((late) => {
        if (late.kind === 'completed' && isDependencyResult<T>(late.value) && late.value.success) {
          try {
            onLateSuccess?.(late.value.data);
          } catch {
            // Late cleanup is best effort and cannot change the settled typed result.
          }
        }
      });
      return err(controlled.failure);
    }
    if (controlled.kind === 'thrown') {
      return err({
        type: 'dependency-rejected',
        message: `${label} failed: ${errorMessage(controlled.cause)}`,
      });
    }
    if (!isDependencyResult<T>(controlled.value)) {
      return err({
        type: 'dependency-rejected',
        message: `${label} failed: dependency returned an invalid result.`,
      });
    }

    const stoppedAfterSettle = controlFailure(input);
    if (stoppedAfterSettle) {
      if (controlled.value.success) onLateSuccess?.(controlled.value.data);
      return err(stoppedAfterSettle);
    }
    if (!controlled.value.success) {
      return err({
        type: 'dependency-rejected',
        message: `${label} failed: ${boundedSummary(controlled.value.error.message, 'Rejected.')}`,
      });
    }
    return ok(controlled.value.data);
  }

  private dependencyFail(
    failure: DependencyFailure,
    stage: ReviewGateStage,
    checkpointCommit: string,
    conversationId?: string
  ): Result<never, ReviewGateError> {
    if (failure.type === 'cancelled' || failure.type === 'deadline-exceeded') {
      return this.controlFail(failure, stage, checkpointCommit, conversationId);
    }
    return this.fail(
      'dependency-rejected',
      stage,
      failure.message,
      checkpointCommit,
      conversationId
    );
  }

  private controlFail(
    failure: ControlFailure,
    stage: ReviewGateStage,
    checkpointCommit: string,
    conversationId?: string
  ): Result<never, ReviewGateError> {
    return this.fail(
      failure.type,
      stage,
      failure.message,
      checkpointCommit,
      conversationId,
      failure.type === 'cancelled'
        ? 'Terminal Review was cancelled.'
        : 'Terminal Review exceeded its deadline.',
      failure.type === 'cancelled' ? 'cancelled' : 'interrupted'
    );
  }

  private fail(
    type: ReviewGateErrorType,
    stage: ReviewGateStage,
    message: string,
    checkpointCommit: string,
    conversationId?: string,
    summary = `Terminal Review failed: ${message}`,
    status: LoopStageResult['status'] = 'failed'
  ): Result<never, ReviewGateError> {
    return err({
      type,
      stage,
      message: boundedSummary(message, 'Terminal Review failed.'),
      checkpointCommit,
      ...(conversationId ? { conversationId } : {}),
      stageResult: this.stageResult(status, summary),
    });
  }

  private stageResult(status: LoopStageResult['status'], summary: string): LoopStageResult {
    return {
      status,
      summary: boundedSummary(summary, 'Terminal Review failed.'),
      completedAt: safeNow(this.dependencies.now),
    };
  }

  private cancelSession(session: unknown, cancellation: ReviewRunCancellation): void {
    if (!session || typeof session !== 'object') return;
    const conversationId = (session as Partial<ReviewSessionInfo>).conversationId;
    if (!validConversationId(conversationId)) return;
    if (cancellation.conversationIds.has(conversationId)) return;
    cancellation.conversationIds.add(conversationId);
    try {
      void Promise.resolve(
        this.dependencies.session.cancelReviewSession({
          conversationId,
          target: copyTarget(cancellation.authoritativeTarget),
        })
      ).catch(() => undefined);
    } catch {
      // Cancellation is best effort; the original typed failure remains authoritative.
    }
  }

  private cancelIfStopped(
    session: ReviewSessionInfo,
    error: ReviewGateError,
    cancellation: ReviewRunCancellation
  ): void {
    if (error.type === 'cancelled' || error.type === 'deadline-exceeded') {
      this.cancelSession(session, cancellation);
    }
  }

  private withCheckpoint(error: ReviewGateError, checkpointCommit: string): ReviewGateError {
    return { ...error, checkpointCommit };
  }

  private withConversation(error: ReviewGateError, conversationId: string): ReviewGateError {
    return { ...error, conversationId };
  }
}

function normalizeInput(
  input: RunTerminalReviewGateInput
): Result<NormalizedReviewGateInput, string> {
  const prompt = loopPromptContextInputSchema.safeParse({
    goal: input.goal,
    acceptanceCriteria: input.acceptanceCriteria,
    baseCommit: input.baseCommit,
    checkpointCommit: input.checkpointCommit,
    handoffs: input.handoffs,
  });
  if (!prompt.success)
    return err('Terminal Review prompt context is invalid or exceeds its bounds.');

  const target = loopSessionTargetSchema.safeParse(input.target);
  if (!target.success) return err('Terminal Review target identity is invalid.');
  if (!loopProviderSchema.safeParse(input.provider).success) {
    return err('Terminal Review provider is invalid.');
  }
  if (
    typeof input.model !== 'string' ||
    input.model.trim().length === 0 ||
    input.model.trim().length > MAX_MODEL_LENGTH
  ) {
    return err('Terminal Review model is invalid.');
  }
  if (
    !Array.isArray(input.workPhaseResults) ||
    input.workPhaseResults.length > MAX_CONVERSATION_IDS ||
    input.workPhaseResults.some((result) => !loopStageResultSchema.safeParse(result).success)
  ) {
    return err('Terminal Review work-phase results are invalid or exceed their bounds.');
  }
  if (
    !Array.isArray(input.previousConversationIds) ||
    input.previousConversationIds.length > MAX_CONVERSATION_IDS ||
    input.previousConversationIds.some((id) => !validConversationId(id)) ||
    new Set(input.previousConversationIds).size !== input.previousConversationIds.length
  ) {
    return err('Terminal Review conversation history is invalid or exceeds its bounds.');
  }
  if (
    input.deadlineAt !== undefined &&
    (!Number.isFinite(input.deadlineAt) || input.deadlineAt < 0)
  ) {
    return err('Terminal Review deadline is invalid.');
  }
  if (input.signal !== undefined && !validAbortSignal(input.signal)) {
    return err('Terminal Review cancellation signal is invalid.');
  }

  let reviewPrompt: string;
  try {
    reviewPrompt = buildTerminalReviewPrompt(prompt.data);
  } catch {
    return err('Terminal Review prompt context is invalid or exceeds its aggregate bound.');
  }

  return ok({
    ...input,
    ...prompt.data,
    target: copyTarget(target.data),
    model: input.model.trim(),
    workPhaseResults: input.workPhaseResults.map((result) => loopStageResultSchema.parse(result)),
    previousConversationIds: [...input.previousConversationIds],
    reviewPrompt,
  });
}

function workspaceInput(
  input: NormalizedReviewGateInput,
  checkpointCommit: string
): ReviewWorkspaceOperationInput {
  return {
    target: copyTarget(input.target),
    baseCommit: input.baseCommit,
    checkpointCommit,
    signal: input.signal,
    deadlineAt: input.deadlineAt,
  };
}

function validateSnapshot(
  snapshot: ReviewWorkspaceSnapshot,
  expectedTarget: LoopSessionTarget,
  expectedHead: string | undefined,
  requireClean: boolean
): { type: 'target-drift' | 'checkpoint-drift' | 'dirty-workspace'; message: string } | undefined {
  if (!snapshot || !sameTarget(snapshot.target, expectedTarget)) {
    return {
      type: 'target-drift',
      message: 'Workspace inspection resolved a different target identity.',
    };
  }
  if (!validCommit(snapshot.headCommit)) {
    return {
      type: 'checkpoint-drift',
      message: 'Workspace inspection returned an invalid head commit.',
    };
  }
  if (requireClean && snapshot.clean !== true) {
    return {
      type: 'dirty-workspace',
      message: 'The Review workspace must be clean at the checkpoint boundary.',
    };
  }
  if (expectedHead !== undefined && !sameCommit(snapshot.headCommit, expectedHead)) {
    return {
      type: 'checkpoint-drift',
      message: 'The Review workspace head drifted from the authoritative checkpoint.',
    };
  }
  return undefined;
}

function validateRange(
  range: ReviewCheckpointRangeValidation,
  expectedTarget: LoopSessionTarget,
  baseCommit: string,
  checkpointCommit: string
):
  | {
      type: 'target-drift' | 'checkpoint-drift' | 'non-linear-checkpoint' | 'unowned-checkpoint';
      message: string;
    }
  | undefined {
  if (!range || !sameTarget(range.target, expectedTarget)) {
    return { type: 'target-drift', message: 'Checkpoint validation used a different target.' };
  }
  if (
    !validCommit(range.baseCommit) ||
    !validCommit(range.checkpointCommit) ||
    !sameCommit(range.baseCommit, baseCommit) ||
    !sameCommit(range.checkpointCommit, checkpointCommit)
  ) {
    return {
      type: 'checkpoint-drift',
      message: 'Checkpoint validation did not attest the authoritative range.',
    };
  }
  if (range.linear !== true) {
    return {
      type: 'non-linear-checkpoint',
      message: 'The authoritative Review checkpoint range is not linear.',
    };
  }
  if (range.loopOwned !== true) {
    return {
      type: 'unowned-checkpoint',
      message: 'The authoritative Review checkpoint is not Loop-owned.',
    };
  }
  return undefined;
}

function validateCorrection(
  correction: ReviewCorrectionValidation,
  expectedTarget: LoopSessionTarget,
  baseCommit: string,
  previousCheckpointCommit: string,
  checkpointCommit: string
):
  | {
      type:
        | 'target-drift'
        | 'checkpoint-drift'
        | 'correction-count'
        | 'non-linear-checkpoint'
        | 'unowned-checkpoint';
      message: string;
    }
  | undefined {
  if (!correction || !sameTarget(correction.target, expectedTarget)) {
    return { type: 'target-drift', message: 'Correction validation used a different target.' };
  }
  if (
    !validCommit(correction.baseCommit) ||
    !validCommit(correction.previousCheckpointCommit) ||
    !validCommit(correction.checkpointCommit) ||
    !validCommit(correction.parentCommit) ||
    !sameCommit(correction.baseCommit, baseCommit) ||
    !sameCommit(correction.previousCheckpointCommit, previousCheckpointCommit) ||
    !sameCommit(correction.checkpointCommit, checkpointCommit)
  ) {
    return {
      type: 'checkpoint-drift',
      message: 'Correction validation did not attest the proposed checkpoint range.',
    };
  }
  if (correction.commitCount !== 1) {
    return {
      type: 'correction-count',
      message: 'Terminal Review may add exactly one correction checkpoint.',
    };
  }
  if (
    !sameCommit(correction.parentCommit, previousCheckpointCommit) ||
    correction.linear !== true
  ) {
    return {
      type: 'non-linear-checkpoint',
      message: 'The Review correction must be one linear child of the previous checkpoint.',
    };
  }
  if (correction.loopOwned !== true) {
    return {
      type: 'unowned-checkpoint',
      message: 'The Review correction checkpoint is not Loop-owned.',
    };
  }
  return undefined;
}

function validateRequiredGate(
  result: ReviewRequiredGateResult,
  expectedTarget: LoopSessionTarget,
  checkpointCommit: string
): { type: 'target-drift' | 'checkpoint-drift'; message: string } | undefined {
  if (!result || !sameTarget(result.target, expectedTarget)) {
    return { type: 'target-drift', message: 'The required gate ran against a different target.' };
  }
  if (
    !validCommit(result.checkpointCommit) ||
    !sameCommit(result.checkpointCommit, checkpointCommit)
  ) {
    return {
      type: 'checkpoint-drift',
      message: 'The required gate did not attest the accepted Review checkpoint.',
    };
  }
  return undefined;
}

async function raceWithControl<T>(
  operation: Promise<ControlledOutcome<T>>,
  input: Pick<RunTerminalReviewGateInput, 'signal' | 'deadlineAt'>
): Promise<ControlledOutcome<T>> {
  if (!input.signal && input.deadlineAt === undefined) return operation;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let detachAbort: (() => void) | undefined;
  const stopped = new Promise<ControlledOutcome<T>>((resolve) => {
    const stop = () => {
      const failure = controlFailure(input);
      if (failure) resolve({ kind: 'stopped', failure });
    };
    if (input.signal) {
      input.signal.addEventListener('abort', stop, { once: true });
      detachAbort = () => input.signal?.removeEventListener('abort', stop);
    }
    if (input.deadlineAt !== undefined) {
      timeout = setTimeout(
        () =>
          resolve({
            kind: 'stopped',
            failure: {
              type: 'deadline-exceeded',
              message: 'Terminal Review exceeded its deadline.',
            },
          }),
        Math.max(0, input.deadlineAt - Date.now())
      );
    }
    stop();
  });

  try {
    return await Promise.race([operation, stopped]);
  } finally {
    if (timeout) clearTimeout(timeout);
    detachAbort?.();
  }
}

function controlFailure(
  input: Pick<RunTerminalReviewGateInput, 'signal' | 'deadlineAt'>
): ControlFailure | undefined {
  if (input.signal?.aborted) {
    return { type: 'cancelled', message: 'Terminal Review was cancelled.' };
  }
  if (input.deadlineAt !== undefined && input.deadlineAt <= Date.now()) {
    return { type: 'deadline-exceeded', message: 'Terminal Review exceeded its deadline.' };
  }
  return undefined;
}

function sameTarget(left: LoopSessionTarget | undefined, right: LoopSessionTarget): boolean {
  const parsedLeft = loopSessionTargetSchema.safeParse(left);
  const parsedRight = loopSessionTargetSchema.safeParse(right);
  if (!parsedLeft.success || !parsedRight.success) return false;
  const leftTarget = parsedLeft.data;
  const rightTarget = parsedRight.data;
  if (
    leftTarget.workspaceId !== rightTarget.workspaceId ||
    leftTarget.path !== rightTarget.path ||
    leftTarget.machine.kind !== rightTarget.machine.kind
  ) {
    return false;
  }
  return leftTarget.machine.kind === 'local'
    ? rightTarget.machine.kind === 'local'
    : rightTarget.machine.kind === 'ssh' &&
        leftTarget.machine.connectionId === rightTarget.machine.connectionId;
}

function copyTarget(target: LoopSessionTarget): LoopSessionTarget {
  return target.machine.kind === 'local'
    ? { workspaceId: target.workspaceId, path: target.path, machine: { kind: 'local' } }
    : {
        workspaceId: target.workspaceId,
        path: target.path,
        machine: { kind: 'ssh', connectionId: target.machine.connectionId },
      };
}

function validConversationId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value === value.trim() &&
    value.length <= MAX_CONVERSATION_ID_LENGTH
  );
}

function isReviewSessionInfo(value: unknown): value is ReviewSessionInfo {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ReviewSessionInfo>;
  return (
    validConversationId(candidate.conversationId) &&
    loopSessionTargetSchema.safeParse(candidate.target).success
  );
}

function validAbortSignal(value: unknown): value is AbortSignal {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AbortSignal>;
  return (
    typeof candidate.aborted === 'boolean' &&
    typeof candidate.addEventListener === 'function' &&
    typeof candidate.removeEventListener === 'function'
  );
}

function isDependencyResult<T>(value: unknown): value is Result<T, ReviewGateDependencyError> {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {
    success?: unknown;
    data?: unknown;
    error?: { type?: unknown; message?: unknown };
  };
  if (candidate.success === true) return 'data' in candidate;
  return (
    candidate.success === false &&
    !!candidate.error &&
    typeof candidate.error.type === 'string' &&
    typeof candidate.error.message === 'string'
  );
}

function validCommit(value: unknown): value is string {
  return loopCommitSchema.safeParse(value).success;
}

function validCommitOrEmpty(value: unknown): string {
  return validCommit(value) ? normalizeCommit(value) : '';
}

function normalizeCommit(value: string): string {
  return value.toLowerCase();
}

function sameCommit(left: string, right: string): boolean {
  return normalizeCommit(left) === normalizeCommit(right);
}

function boundedSummary(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, MAX_STAGE_SUMMARY_LENGTH);
}

function errorMessage(cause: unknown): string {
  return boundedSummary(
    cause instanceof Error ? cause.message : String(cause),
    'Unknown rejection.'
  );
}

function safeNow(now: () => Date): string {
  try {
    const value = now();
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  } catch {
    // A deterministic fallback keeps the stage result serializable.
  }
  return new Date().toISOString();
}
