import { randomUUID } from 'node:crypto';
import { err, ok, type Result } from '@main/lib/result';
import { loopPhaseStateV2Schema, type LoopStageResult } from '@shared/core/loops/loop-phase-state';
import {
  loopStateV2Schema,
  type LoopSessionAttempt,
  type LoopStateV2,
} from '@shared/core/loops/loop-state';
import type { Loop, LoopPhase, LoopPhaseCriteria, LoopWithPhases } from '@shared/core/loops/loops';
import {
  resolvePromptTimeoutMs,
  safeMessage,
  sendPromptWithTimeout,
} from './drivers/prompt-timeout';
import type { LoopSessionDriver } from './drivers/session-driver';
import { boundedSummary } from './gates/clean-room-e2e-boundary';
import { buildLoopPhaseHandoff } from './handoff-builder';
import {
  getLoop,
  updateLoop as updateLoopRow,
  updatePhase as updatePhaseRow,
} from './operations/loop-operations';
import { commitSessionAttempt } from './operations/session-progress';
import {
  commitTerminalPhaseFailure,
  commitTerminalPhaseSuccess,
} from './operations/terminal-phase-progress';
import type { LoopOperationError } from './operations/types';
import { commitWorkPhaseProgress } from './operations/work-phase-progress';
import {
  buildPhasePrompt,
  buildRetryPrompt,
  buildReviewPrompt,
  parsePhaseSentinel,
  parseReviewSentinel,
  PHASE_DONE_SENTINEL,
  REVIEW_APPROVED_SENTINEL,
  buildWorkPrompt,
  parseWorkSentinel,
} from './prompt-builder';
import { runLoopCommand } from './runtime/loop-command-runner';
import type { LoopExecutionTarget } from './runtime/loop-execution-target';
import { runTerminalReviewPhase } from './runtime/terminal-review-runtime';
import { runExecFile, type ExecFileFailure } from './verifiers/exec';
import { getVerifier } from './verifiers/registry';
import type {
  BuiltInVerifierId,
  LoopVerifier,
  VerifierError,
  VerifierEvidence,
} from './verifiers/types';

export const MAX_PHASE_ATTEMPTS = 3;
export const DEFAULT_PROMPT_TIMEOUT_MS = 20 * 60 * 1000;
export const DEFAULT_VERIFIER_PROMPT_TIMEOUT_MS = 15 * 60 * 1000;

export type LoopRunError =
  | { kind: 'invalid-state'; message: string }
  | { kind: 'paused'; message: string }
  | { kind: 'cancelled'; message: string }
  | { kind: 'driver-error'; message: string }
  | { kind: 'operation-error'; message: string; cause?: LoopOperationError }
  | { kind: 'verifier-error'; message: string; verifierId?: BuiltInVerifierId }
  | { kind: 'sentinel-error'; message: string };

export type LoopRunControl = {
  signal: AbortSignal;
  stopReason(): 'pause' | 'cancel' | null;
  setActiveConversation(
    conversationId: string | null,
    driver: LoopSessionDriver | null
  ): void | Promise<void>;
};

export type PhaseRunnerDeps = {
  getLoop(loopId: string): Promise<LoopWithPhases | null>;
  updateLoop: typeof updateLoopRow;
  updatePhase: typeof updatePhaseRow;
  getVerifier(id: BuiltInVerifierId): LoopVerifier | undefined;
  getDiff(cwd: string): Promise<string>;
  promptTimeoutMs: number;
  verifierPromptTimeoutMs: number;
  commitSessionAttempt: typeof commitSessionAttempt;
  commitWorkPhaseProgress: typeof commitWorkPhaseProgress;
  commitTerminalPhaseFailure: typeof commitTerminalPhaseFailure;
  commitTerminalPhaseSuccess: typeof commitTerminalPhaseSuccess;
  runTerminalReviewPhase: typeof runTerminalReviewPhase;
  runCleanRoomE2EPhase(input: {
    loop: LoopWithPhases;
    phase: LoopPhase;
    executionTarget: LoopExecutionTarget;
    driver: LoopSessionDriver;
    signal: AbortSignal;
    setActiveConversation(
      conversationId: string | null,
      driver: LoopSessionDriver | null
    ): void | Promise<void>;
  }): Promise<Result<{ stageResult: LoopStageResult }, { message: string }>>;
  now(): Date;
  onLoopUpdated?(loop: Loop): void;
  onPhaseUpdated?(phase: LoopPhase): void;
};

export type RunPhaseInput = {
  loop: LoopWithPhases;
  phase: LoopPhase;
  executionTarget: LoopExecutionTarget;
  driver: LoopSessionDriver;
  control: LoopRunControl;
};

export type RunPhaseResult =
  | { kind: 'passed'; loop: LoopWithPhases; phase: LoopPhase }
  | { kind: 'failed'; loop: LoopWithPhases; phase: LoopPhase }
  | { kind: 'paused'; loop: LoopWithPhases; phase: LoopPhase }
  | { kind: 'cancelled'; loop: LoopWithPhases; phase: LoopPhase };

async function defaultGetDiff(cwd: string): Promise<string> {
  const [stat, diff] = await Promise.allSettled([
    runExecFile('git', ['diff', '--stat'], { cwd, timeoutMs: 60_000 }),
    runExecFile('git', ['diff', '--no-ext-diff'], {
      cwd,
      timeoutMs: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    }),
  ]);

  const statText = stat.status === 'fulfilled' ? stat.value.stdoutTail : '';
  const diffText =
    diff.status === 'fulfilled'
      ? diff.value.stdoutTail
      : `git diff failed: ${(diff.reason as ExecFileFailure).message}`;
  return [statText, diffText].filter(Boolean).join('\n\n');
}

function defaultDeps(): PhaseRunnerDeps {
  return {
    getLoop,
    updateLoop: updateLoopRow,
    updatePhase: updatePhaseRow,
    getVerifier,
    getDiff: defaultGetDiff,
    promptTimeoutMs: resolvePromptTimeoutMs(DEFAULT_PROMPT_TIMEOUT_MS),
    verifierPromptTimeoutMs: resolvePromptTimeoutMs(DEFAULT_VERIFIER_PROMPT_TIMEOUT_MS),
    commitSessionAttempt,
    commitWorkPhaseProgress,
    commitTerminalPhaseFailure,
    commitTerminalPhaseSuccess,
    runTerminalReviewPhase,
    runCleanRoomE2EPhase: async (input) =>
      (await import('./runtime/clean-room-e2e-runtime')).runCleanRoomE2EPhase(input),
    now: () => new Date(),
  };
}

function safeEvidenceSummary(evidence: VerifierEvidence): string {
  return (
    [evidence.summary, evidence.stdoutTail, evidence.stderrTail]
      .map((value) => value.trim())
      .find((value) => value.length > 0) ?? `${evidence.label} passed.`
  );
}

function stopError(reason: 'pause' | 'cancel'): LoopRunError {
  return reason === 'pause'
    ? { kind: 'paused', message: 'Loop paused' }
    : { kind: 'cancelled', message: 'Loop cancelled' };
}

function evidenceText(evidence: VerifierEvidence): string {
  return JSON.stringify({
    summary: safeEvidenceSummary(evidence),
    command: evidence.command,
    exitCode: evidence.exitCode,
    durationMs: evidence.durationMs,
    stdoutTail: evidence.stdoutTail,
    stderrTail: evidence.stderrTail,
    evidencePath: evidence.evidencePath,
  });
}

function errorText(error: VerifierError): string {
  return JSON.stringify({
    message: error.message,
    command: error.command,
    exitCode: error.exitCode,
    durationMs: error.durationMs,
    stdoutTail: error.stdoutTail,
    stderrTail: error.stderrTail,
    evidencePath: error.evidencePath,
  });
}

function updateCriteriaForVerifier(
  criteria: LoopPhaseCriteria | null,
  verifierId: BuiltInVerifierId,
  status: 'pending' | 'verifying' | 'passed' | 'failed',
  evidence?: string
): LoopPhaseCriteria | null {
  if (!criteria || verifierId === 'unit-tests') return criteria;
  return {
    ...criteria,
    criteria: criteria.criteria.map((criterion) =>
      criterion.verifier === verifierId
        ? {
            ...criterion,
            status,
            ...(evidence !== undefined ? { evidence } : {}),
          }
        : criterion
    ),
  };
}

function failureSummary(
  failures: Array<VerifierError | { kind: 'sentinel'; message: string }>
): string {
  return failures.map((failure) => safeMessage(failure.message, 'Loop attempt failed')).join('\n');
}

export class PhaseRunner {
  private readonly deps: PhaseRunnerDeps;

  constructor(deps: Partial<PhaseRunnerDeps> = {}) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  async runPhase(input: RunPhaseInput): Promise<Result<RunPhaseResult, LoopRunError>> {
    if (input.loop.config?.version === '2') {
      if ((input.phase.kind ?? 'work') === 'review') {
        return this.runV2ReviewPhase(input);
      }
      if ((input.phase.kind ?? 'work') === 'e2e') {
        return this.runV2E2EPhase(input);
      }
      if ((input.phase.kind ?? 'work') !== 'work') {
        return err({
          kind: 'invalid-state',
          message: `Terminal ${input.phase.kind} phase is not bound to its production gate`,
        } as LoopRunError);
      }
      return this.runV2WorkPhase(input);
    }

    const cwd = input.executionTarget.path;
    let loop: LoopWithPhases = input.loop;
    let phase: LoopPhase = input.phase;
    let conversationId = phase.conversationId;
    let retryFailures: Array<VerifierError | { kind: 'sentinel'; message: string }> = [];
    let passingEvidence: VerifierEvidence[] = [];
    let reviewFeedback: string | undefined;

    const ensureNotStopped = (): Result<void, LoopRunError> => {
      const reason = input.control.stopReason();
      if (!reason) return ok();
      return err(stopError(reason));
    };

    const reload = async (): Promise<Result<void, LoopRunError>> => {
      const reloaded = await this.deps.getLoop(loop.id);
      if (!reloaded) {
        return err({ kind: 'operation-error', message: 'Loop disappeared during run' });
      }
      loop = reloaded;
      phase = reloaded.phases.find((candidate) => candidate.id === phase.id) ?? phase;
      return ok();
    };

    while (phase.attempts < MAX_PHASE_ATTEMPTS) {
      const stopped = ensureNotStopped();
      if (!stopped.success) {
        return ok({ kind: stopped.error.kind, loop, phase } as RunPhaseResult);
      }

      if (!conversationId) {
        const session = await input.driver.startPhaseSession({
          loop,
          phase,
          purpose: 'work',
          target: input.executionTarget,
          taskEnvironment: input.executionTarget.taskEnv,
        });
        if (!session.success) {
          return err({
            kind: 'driver-error',
            message: safeMessage(session.error.message, 'Failed to start loop session'),
          });
        }
        conversationId = session.data.conversationId;
        await input.control.setActiveConversation(conversationId, input.driver);
        const updated = await this.transitionPhase(phase.id, { conversationId });
        if (!updated.success) return err(updated.error);
        phase = updated.data;
      } else {
        await input.control.setActiveConversation(conversationId, input.driver);
      }

      const attempt = phase.attempts + 1;
      const running = await this.transitionPhase(phase.id, {
        status: 'running',
        attempts: attempt,
        lastError: null,
      });
      if (!running.success) return err(running.error);
      phase = running.data;

      const prompt =
        retryFailures.length === 0 && !reviewFeedback
          ? buildPhasePrompt({ loop, phase, attempt })
          : buildRetryPrompt({
              phase,
              attempt,
              failures: retryFailures,
              evidence: passingEvidence,
              reviewFeedback,
            });

      const promptResult = await sendPromptWithTimeout({
        driver: input.driver,
        conversationId,
        prompt,
        timeoutMs: this.deps.promptTimeoutMs,
        failureMessage: 'Loop prompt failed',
        timeoutLabel: 'Loop prompt',
      });
      const afterPromptStop = ensureNotStopped();
      if (!afterPromptStop.success) {
        await input.control.setActiveConversation(null, null);
        return ok({ kind: afterPromptStop.error.kind, loop, phase } as RunPhaseResult);
      }
      if (!promptResult.success) {
        retryFailures = [
          {
            kind: 'sentinel',
            message: safeMessage(promptResult.error.message, 'Loop prompt failed'),
          },
        ];
        const exhausted = await this.handleAttemptFailure(loop, phase, retryFailures);
        if (!exhausted.success) return err(exhausted.error);
        if (exhausted.data.kind === 'failed') return ok(exhausted.data);
        await reload();
        continue;
      }

      const sentinel = parsePhaseSentinel(promptResult.data.finalText);
      if (!sentinel) {
        retryFailures = [
          {
            kind: 'sentinel',
            message: `Missing ${PHASE_DONE_SENTINEL} or <<<LOOP:PHASE_FAILED reason>>> sentinel`,
          },
        ];
        const exhausted = await this.handleAttemptFailure(loop, phase, retryFailures);
        if (!exhausted.success) return err(exhausted.error);
        if (exhausted.data.kind === 'failed') return ok(exhausted.data);
        await reload();
        continue;
      }

      if (sentinel.kind === 'failed') {
        retryFailures = [{ kind: 'sentinel', message: sentinel.reason }];
        const exhausted = await this.handleAttemptFailure(loop, phase, retryFailures);
        if (!exhausted.success) return err(exhausted.error);
        if (exhausted.data.kind === 'failed') return ok(exhausted.data);
        await reload();
        continue;
      }

      const verifying = await this.transitionPhase(phase.id, { status: 'verifying' });
      if (!verifying.success) return err(verifying.error);
      phase = verifying.data;

      const verifierResult = await this.runVerifierGate(
        loop,
        phase,
        cwd,
        input.executionTarget,
        input.driver,
        input.control
      );
      if (!verifierResult.success) return err(verifierResult.error);
      passingEvidence = verifierResult.data.evidence;
      retryFailures = verifierResult.data.failures;

      if (retryFailures.length > 0) {
        const exhausted = await this.handleAttemptFailure(loop, phase, retryFailures);
        if (!exhausted.success) return err(exhausted.error);
        if (exhausted.data.kind === 'failed') return ok(exhausted.data);
        await reload();
        continue;
      }

      if (loop.config?.version === '1' && loop.config.reviewEnabled) {
        const review = await this.runReviewGate(
          loop,
          phase,
          cwd,
          input.executionTarget,
          input.driver,
          input.control
        );
        if (!review.success) return err(review.error);
        if (review.data.kind === 'changes') {
          reviewFeedback = review.data.feedback;
          retryFailures = [{ kind: 'sentinel', message: reviewFeedback }];
          const exhausted = await this.handleAttemptFailure(loop, phase, retryFailures);
          if (!exhausted.success) return err(exhausted.error);
          if (exhausted.data.kind === 'failed') return ok(exhausted.data);
          await reload();
          continue;
        }
      }

      const passed = await this.transitionPhase(phase.id, { status: 'passed', lastError: null });
      if (!passed.success) return err(passed.error);
      phase = passed.data;
      await input.control.setActiveConversation(null, null);
      const reloaded = await this.deps.getLoop(loop.id);
      return ok({ kind: 'passed', loop: reloaded ?? loop, phase });
    }

    const failed = await this.markPhaseAndLoopFailed(loop, phase, 'Maximum attempts reached');
    if (!failed.success) return err(failed.error);
    return ok(failed.data);
  }

  private async runV2WorkPhase(
    input: RunPhaseInput
  ): Promise<Result<RunPhaseResult, LoopRunError>> {
    let loop = input.loop;
    let phase = input.phase;
    const loopState = loopStateV2Schema.safeParse(loop.state);
    const phaseState = loopPhaseStateV2Schema.safeParse(phase.state);
    if (
      !loopState.success ||
      !phaseState.success ||
      !loopState.data.baseCommit ||
      !loopState.data.checkpointCommit
    ) {
      return err({
        kind: 'invalid-state',
        message: 'Loop checkpoint authority is not initialized',
      } as LoopRunError);
    }

    let durableLoopState = loopState.data;
    const stoppedBeforeStart = await this.stopV2Work(input, loop, phase);
    if (stoppedBeforeStart) return stoppedBeforeStart;
    const conversationId = randomUUID();
    const attemptId = randomUUID();
    const startedAt = this.deps.now().toISOString();
    const target = {
      workspaceId: input.executionTarget.workspaceId,
      path: input.executionTarget.path,
      machine: input.executionTarget.machine,
    };
    let sessionAttempt: LoopSessionAttempt = {
      attemptId,
      conversationId,
      purpose: 'work',
      phaseId: phase.id,
      target,
      status: 'starting',
      checkpointBefore: durableLoopState.checkpointCommit ?? undefined,
      startedAt,
    };
    const appended = await this.deps.commitSessionAttempt({
      loopId: loop.id,
      expected: durableLoopState,
      next: sessionAttempt,
    });
    if (!appended.success) return this.operationFailure(appended.error);
    durableLoopState = appended.data;
    const stoppedBeforeSession = await this.stopV2Work(
      input,
      loop,
      phase,
      durableLoopState,
      sessionAttempt
    );
    if (stoppedBeforeSession) return stoppedBeforeSession;

    const session = await input.driver.startPhaseSession({
      loop,
      phase,
      purpose: 'work',
      target,
      taskEnvironment: input.executionTarget.taskEnv,
      conversationId,
    });
    if (!session.success) {
      const stopped = await this.stopV2Work(input, loop, phase, durableLoopState, sessionAttempt);
      if (stopped) return stopped;
      const finished = await this.finishSessionAttempt(
        loop.id,
        durableLoopState,
        sessionAttempt,
        'failed',
        undefined,
        session.error.message
      );
      if (!finished.success) return finished;
      return err({
        kind: 'driver-error',
        message: safeMessage(session.error.message, 'Failed to start Loop work session'),
      });
    }

    await input.control.setActiveConversation(conversationId, input.driver);
    const stoppedAfterSession = await this.stopV2Work(
      input,
      loop,
      phase,
      durableLoopState,
      sessionAttempt
    );
    if (stoppedAfterSession) return stoppedAfterSession;

    const runningAttempt: LoopSessionAttempt = { ...sessionAttempt, status: 'running' };
    const runningCommit = await this.deps.commitSessionAttempt({
      loopId: loop.id,
      expected: durableLoopState,
      previous: sessionAttempt,
      next: runningAttempt,
    });
    if (!runningCommit.success) return this.operationFailure(runningCommit.error);
    durableLoopState = runningCommit.data;
    sessionAttempt = runningAttempt;
    const stoppedAfterRunningCommit = await this.stopV2Work(
      input,
      loop,
      phase,
      durableLoopState,
      sessionAttempt
    );
    if (stoppedAfterRunningCommit) return stoppedAfterRunningCommit;

    const phaseRunning = await this.transitionPhase(phase.id, {
      conversationId,
      status: 'running',
      attempts: phase.attempts + 1,
      lastError: null,
    });
    if (!phaseRunning.success) return err(phaseRunning.error);
    phase = phaseRunning.data;
    const stoppedAfterPhaseTransition = await this.stopV2Work(
      input,
      loop,
      phase,
      durableLoopState,
      sessionAttempt
    );
    if (stoppedAfterPhaseTransition) return stoppedAfterPhaseTransition;

    const previousPhase = loop.phases
      .filter((candidate) => candidate.idx < phase.idx)
      .sort((left, right) => right.idx - left.idx)[0];
    const previousState = loopPhaseStateV2Schema.safeParse(previousPhase?.state);
    const priorHandoff =
      previousPhase && previousState.success && previousState.data.handoff
        ? { source: previousPhase.name, handoff: previousState.data.handoff }
        : null;
    const prompt = buildWorkPrompt({
      goal: phase.goal,
      acceptanceCriteria: phase.criteria?.criteria.map((criterion) => criterion.description) ?? [
        phase.goal,
      ],
      baseCommit: durableLoopState.baseCommit!,
      checkpointCommit: durableLoopState.checkpointCommit!,
      priorHandoff,
    });
    const promptResult = await sendPromptWithTimeout({
      driver: input.driver,
      conversationId,
      prompt,
      timeoutMs: this.deps.promptTimeoutMs,
      failureMessage: 'Loop work prompt failed',
      timeoutLabel: 'Loop work prompt',
    });
    const stoppedAfterPrompt = await this.stopV2Work(
      input,
      loop,
      phase,
      durableLoopState,
      sessionAttempt
    );
    if (stoppedAfterPrompt) return stoppedAfterPrompt;
    if (!promptResult.success) {
      const finished = await this.finishSessionAttempt(
        loop.id,
        durableLoopState,
        sessionAttempt,
        'failed',
        undefined,
        promptResult.error.message
      );
      if (!finished.success) return finished;
      return this.markV2WorkFailed(loop, phase, promptResult.error.message);
    }
    const sentinel = parseWorkSentinel(promptResult.data.finalText);
    if (!sentinel || sentinel.kind === 'failed') {
      const message =
        sentinel?.kind === 'failed' ? sentinel.reason : `Missing strict ${PHASE_DONE_SENTINEL}`;
      const finished = await this.finishSessionAttempt(
        loop.id,
        durableLoopState,
        sessionAttempt,
        'failed',
        undefined,
        message
      );
      if (!finished.success) return finished;
      return this.markV2WorkFailed(loop, phase, message);
    }

    const verifying = await this.transitionPhase(phase.id, { status: 'verifying' });
    if (!verifying.success) return err(verifying.error);
    phase = verifying.data;
    const verifier = this.deps.getVerifier('unit-tests');
    if (!verifier) {
      return this.markV2WorkFailed(loop, phase, 'Unit-test verifier is unavailable');
    }
    const verification = await verifier.run({
      loop,
      phase,
      cwd: input.executionTarget.path,
      executionTarget: input.executionTarget,
      taskEnvironment: input.executionTarget.taskEnv,
      validationCommands: loop.config?.version === '2' ? loop.config.validationCommands : [],
      criteria: phase.criteria?.criteria ?? [],
      signal: input.control.signal,
    });
    const stoppedAfterVerification = await this.stopV2Work(
      input,
      loop,
      phase,
      durableLoopState,
      sessionAttempt
    );
    if (stoppedAfterVerification) return stoppedAfterVerification;
    if (!verification.success) {
      const finished = await this.finishSessionAttempt(
        loop.id,
        durableLoopState,
        sessionAttempt,
        'failed',
        undefined,
        verification.error.message
      );
      if (!finished.success) return finished;
      return this.markV2WorkFailed(loop, phase, verification.error.message);
    }

    try {
      const status = await runLoopCommand(input.executionTarget, 'git', ['status', '--porcelain'], {
        signal: input.control.signal,
      });
      if (status.stdout.trim()) {
        await runLoopCommand(input.executionTarget, 'git', ['add', '-A'], {
          signal: input.control.signal,
        });
        await runLoopCommand(
          input.executionTarget,
          'git',
          [
            '-c',
            'user.name=Emdash Loop',
            '-c',
            'user.email=loops@emdash.local',
            'commit',
            '-m',
            `chore(loops): checkpoint ${phase.name}`,
          ],
          { signal: input.control.signal }
        );
      }
      const head = await runLoopCommand(input.executionTarget, 'git', ['rev-parse', 'HEAD'], {
        signal: input.control.signal,
      });
      const checkpointCommit = head.stdout.trim();
      const completedAt = this.deps.now().toISOString();
      const summary = boundedSummary(promptResult.data.finalText, 'Work phase passed.');
      const handoff = buildLoopPhaseHandoff({
        summary,
        risks: [],
        remainingWork: [],
        artifacts: [],
        createdAt: completedAt,
      });
      const completedAttempt: LoopSessionAttempt = {
        ...sessionAttempt,
        status: 'completed',
        checkpointAfter: checkpointCommit,
        finishedAt: completedAt,
      };
      const committed = await this.deps.commitWorkPhaseProgress({
        loopId: loop.id,
        phaseId: phase.id,
        expectedLoopState: durableLoopState,
        expectedPhaseState: phaseState.data,
        checkpointCommit,
        handoff,
        summary,
        completedAt,
        previousAttempt: sessionAttempt,
        completedAttempt,
      });
      if (!committed.success) return this.operationFailure(committed.error);
      loop = committed.data.loop;
      phase = committed.data.phase;
      this.deps.onLoopUpdated?.(loop);
      this.deps.onPhaseUpdated?.(phase);
      await input.control.setActiveConversation(null, null);
      return ok({ kind: 'passed', loop, phase });
    } catch (error) {
      const stopped = await this.stopV2Work(input, loop, phase, durableLoopState, sessionAttempt);
      if (stopped) return stopped;
      const message = error instanceof Error ? error.message : String(error);
      const finished = await this.finishSessionAttempt(
        loop.id,
        durableLoopState,
        sessionAttempt,
        'failed',
        undefined,
        message
      );
      if (!finished.success) return finished;
      return this.markV2WorkFailed(loop, phase, message);
    }
  }

  private async stopV2Work(
    input: RunPhaseInput,
    loop: LoopWithPhases,
    phase: LoopPhase,
    state?: LoopStateV2,
    attempt?: LoopSessionAttempt
  ): Promise<Result<RunPhaseResult, LoopRunError> | null> {
    const reason = input.control.stopReason();
    if (!reason) return null;
    if (state && attempt) {
      const finished = await this.finishSessionAttempt(
        loop.id,
        state,
        attempt,
        reason === 'pause' ? 'interrupted' : 'cancelled',
        undefined,
        reason === 'pause' ? 'Loop paused' : 'Loop cancelled'
      );
      if (!finished.success) return finished;
    }
    await input.control.setActiveConversation(null, null);
    return ok({ kind: reason === 'pause' ? 'paused' : 'cancelled', loop, phase });
  }

  private async runV2ReviewPhase(
    input: RunPhaseInput
  ): Promise<Result<RunPhaseResult, LoopRunError>> {
    const loopState = loopStateV2Schema.safeParse(input.loop.state);
    const phaseState = loopPhaseStateV2Schema.safeParse(input.phase.state);
    if (!loopState.success || !phaseState.success || !loopState.data.checkpointCommit) {
      return err({ kind: 'invalid-state', message: 'Review checkpoint authority is unavailable' });
    }
    const reviewing = await this.transitionPhase(input.phase.id, {
      status: 'reviewing',
      attempts: input.phase.attempts + 1,
      lastError: null,
    });
    if (!reviewing.success) return err(reviewing.error);
    const result = await this.deps.runTerminalReviewPhase({
      ...input,
      phase: reviewing.data,
    });
    if (!result.success) {
      const { checkpointCommit, conversationId, observedHead, stageResult } = result.error;
      const recoverableCheckpoint =
        result.error.recoveryRequired === false &&
        checkpointCommit !== undefined &&
        observedHead === checkpointCommit &&
        checkpointCommit !== loopState.data.checkpointCommit &&
        conversationId !== undefined &&
        stageResult !== undefined;
      if (recoverableCheckpoint && checkpointCommit && conversationId && stageResult) {
        const completedAt = stageResult.completedAt;
        const message = boundedSummary(result.error.message, 'Terminal Review failed');
        const attempt: LoopSessionAttempt = {
          attemptId: randomUUID(),
          conversationId,
          purpose: 'review',
          phaseId: input.phase.id,
          target: {
            workspaceId: input.executionTarget.workspaceId,
            path: input.executionTarget.path,
            machine: input.executionTarget.machine,
          },
          status: 'failed',
          checkpointBefore: loopState.data.checkpointCommit,
          checkpointAfter: checkpointCommit,
          startedAt: completedAt,
          finishedAt: completedAt,
          error: message,
        };
        const committed = await this.deps.commitTerminalPhaseFailure({
          loopId: input.loop.id,
          phaseId: input.phase.id,
          expectedLoopState: loopState.data,
          expectedPhaseState: phaseState.data,
          checkpointCommit,
          result: stageResult,
          sessionAttempts: [...loopState.data.sessionAttempts, attempt],
          lastError: message,
        });
        if (!committed.success) return this.operationFailure(committed.error);
        this.deps.onLoopUpdated?.(committed.data.loop);
        this.deps.onPhaseUpdated?.(committed.data.phase);
        return ok({ kind: 'failed', loop: committed.data.loop, phase: committed.data.phase });
      }
      return this.markV2WorkFailed(input.loop, reviewing.data, result.error.message);
    }

    const completedAt = result.data.stageResult.completedAt;
    const handoff = buildLoopPhaseHandoff({
      summary: boundedSummary(result.data.requiredGateSummary, 'Terminal Review passed.'),
      risks: [],
      remainingWork: [],
      artifacts: [],
      createdAt: completedAt,
    });
    const attempt: LoopSessionAttempt = {
      attemptId: randomUUID(),
      conversationId: result.data.conversationId,
      purpose: 'review',
      phaseId: input.phase.id,
      target: result.data.target,
      status: 'completed',
      checkpointBefore: result.data.previousCheckpointCommit,
      checkpointAfter: result.data.checkpointCommit,
      startedAt: completedAt,
      finishedAt: completedAt,
    };
    const committed = await this.deps.commitTerminalPhaseSuccess({
      loopId: input.loop.id,
      phaseId: input.phase.id,
      expectedLoopState: loopState.data,
      expectedPhaseState: phaseState.data,
      checkpointCommit: result.data.checkpointCommit,
      handoff,
      result: result.data.stageResult,
      sessionAttempts: [...loopState.data.sessionAttempts, attempt],
    });
    if (!committed.success) return this.operationFailure(committed.error);
    this.deps.onLoopUpdated?.(committed.data.loop);
    this.deps.onPhaseUpdated?.(committed.data.phase);
    return ok({ kind: 'passed', loop: committed.data.loop, phase: committed.data.phase });
  }

  private async runV2E2EPhase(input: RunPhaseInput): Promise<Result<RunPhaseResult, LoopRunError>> {
    const reviewing = await this.transitionPhase(input.phase.id, {
      status: 'reviewing',
      attempts: input.phase.attempts + 1,
      lastError: null,
    });
    if (!reviewing.success) return err(reviewing.error);
    const result = await this.deps.runCleanRoomE2EPhase({
      loop: input.loop,
      phase: reviewing.data,
      executionTarget: input.executionTarget,
      driver: input.driver,
      signal: input.control.signal,
      setActiveConversation: input.control.setActiveConversation.bind(input.control),
    });
    const reloaded = await this.deps.getLoop(input.loop.id);
    const phase = reloaded?.phases.find((candidate) => candidate.id === input.phase.id);
    if (!reloaded || !phase) {
      return err({ kind: 'operation-error', message: 'E2E phase disappeared during execution' });
    }
    this.deps.onLoopUpdated?.(reloaded);
    this.deps.onPhaseUpdated?.(phase);

    const stopped = input.control.stopReason();
    if (stopped) {
      return ok({
        kind: stopped === 'pause' ? 'paused' : 'cancelled',
        loop: reloaded,
        phase,
      });
    }
    const phaseState = loopPhaseStateV2Schema.safeParse(phase.state);
    if (result.success && phase.status === 'passed' && phaseState.success) {
      return ok({ kind: 'passed', loop: reloaded, phase });
    }
    if (phase.status === 'failed' && phaseState.success && phaseState.data.result) {
      const failedLoop = await this.transitionLoop(reloaded.id, { status: 'failed' });
      if (!failedLoop.success) return err(failedLoop.error);
      return ok({ kind: 'failed', loop: { ...reloaded, status: 'failed' }, phase });
    }
    return err({
      kind: 'driver-error',
      message: result.success
        ? 'Clean-room E2E gate did not persist a terminal result'
        : result.error.message,
    });
  }

  private async finishSessionAttempt(
    loopId: string,
    state: LoopStateV2,
    previous: LoopSessionAttempt,
    status: 'failed' | 'cancelled' | 'interrupted',
    checkpointAfter?: string,
    error?: string
  ): Promise<Result<LoopStateV2, LoopRunError>> {
    const committed = await this.deps.commitSessionAttempt({
      loopId,
      expected: state,
      previous,
      next: {
        ...previous,
        status,
        ...(checkpointAfter ? { checkpointAfter } : {}),
        finishedAt: this.deps.now().toISOString(),
        ...(error ? { error: boundedSummary(error, 'Loop session failed') } : {}),
      },
    });
    return committed.success ? ok(committed.data) : this.operationFailure(committed.error);
  }

  private operationFailure(error: LoopOperationError): Result<never, LoopRunError> {
    return err({ kind: 'operation-error', message: error.message, cause: error });
  }

  private async markV2WorkFailed(
    loop: LoopWithPhases,
    phase: LoopPhase,
    message: string
  ): Promise<Result<RunPhaseResult, LoopRunError>> {
    const failed = await this.markPhaseAndLoopFailed(
      loop,
      phase,
      boundedSummary(message, 'Loop work phase failed')
    );
    return failed.success ? ok(failed.data) : err(failed.error);
  }

  private async runVerifierGate(
    loop: Loop,
    phase: LoopPhase,
    cwd: string,
    executionTarget: LoopExecutionTarget,
    driver: LoopSessionDriver,
    control: LoopRunControl
  ): Promise<
    Result<
      {
        evidence: VerifierEvidence[];
        failures: Array<VerifierError | { kind: 'sentinel'; message: string }>;
      },
      LoopRunError
    >
  > {
    const evidence: VerifierEvidence[] = [];
    const failures: VerifierError[] = [];
    const verifierIds: BuiltInVerifierId[] = ['unit-tests', ...(loop.config?.verifiers ?? [])];

    for (const verifierId of verifierIds) {
      const stopped = control.stopReason();
      if (stopped) return err(stopError(stopped));

      const verifier = this.deps.getVerifier(verifierId);
      if (!verifier) {
        failures.push({
          kind: 'invalid-config',
          verifierId,
          message: `Unknown verifier: ${verifierId}`,
          cwd,
        });
        break;
      }

      const marking = await this.transitionPhase(phase.id, {
        criteria: updateCriteriaForVerifier(phase.criteria, verifierId, 'verifying'),
      });
      if (!marking.success) return err(marking.error);
      phase = marking.data;

      const result = await verifier.run({
        loop,
        phase,
        cwd,
        validationCommands: loop.config?.validationCommands ?? [],
        criteria: phase.criteria?.criteria ?? [],
        signal: control.signal,
        sessionDriver: driver,
        executionTarget,
        taskEnvironment: executionTarget.taskEnv,
        promptTimeoutMs: this.deps.verifierPromptTimeoutMs,
        setActiveConversation: control.setActiveConversation.bind(control),
      });

      if (result.success) {
        evidence.push(result.data);
        const updated = await this.transitionPhase(phase.id, {
          criteria: updateCriteriaForVerifier(
            phase.criteria,
            verifierId,
            'passed',
            evidenceText(result.data)
          ),
        });
        if (!updated.success) return err(updated.error);
        phase = updated.data;
        continue;
      }

      failures.push(result.error);
      const updated = await this.transitionPhase(phase.id, {
        criteria: updateCriteriaForVerifier(
          phase.criteria,
          verifierId,
          'failed',
          errorText(result.error)
        ),
      });
      if (!updated.success) return err(updated.error);
      break;
    }

    return ok({ evidence, failures });
  }

  private async runReviewGate(
    loop: Loop,
    phase: LoopPhase,
    cwd: string,
    executionTarget: LoopExecutionTarget,
    driver: LoopSessionDriver,
    control: LoopRunControl
  ): Promise<Result<{ kind: 'approved' } | { kind: 'changes'; feedback: string }, LoopRunError>> {
    const reviewing = await this.transitionPhase(phase.id, { status: 'reviewing' });
    if (!reviewing.success) return err(reviewing.error);
    phase = reviewing.data;

    const session = await driver.startPhaseSession({
      loop,
      phase,
      purpose: 'review',
      target: executionTarget,
      taskEnvironment: executionTarget.taskEnv,
    });
    if (!session.success) {
      return err({
        kind: 'driver-error',
        message: safeMessage(session.error.message, 'Failed to start loop review session'),
      });
    }
    await control.setActiveConversation(session.data.conversationId, driver);

    const diff = await this.deps.getDiff(cwd);
    const promptResult = await sendPromptWithTimeout({
      driver,
      conversationId: session.data.conversationId,
      prompt: buildReviewPrompt({ loop, phase, diff }),
      timeoutMs: this.deps.promptTimeoutMs,
      failureMessage: 'Loop review prompt failed',
      timeoutLabel: 'Loop prompt',
    });
    if (!promptResult.success) {
      return err({
        kind: 'driver-error',
        message: safeMessage(promptResult.error.message, 'Loop review prompt failed'),
      });
    }

    const sentinel = parseReviewSentinel(promptResult.data.finalText);
    if (!sentinel) {
      return ok({
        kind: 'changes',
        feedback: `Review response did not include ${REVIEW_APPROVED_SENTINEL} or <<<LOOP:REVIEW_CHANGES ...>>>`,
      });
    }

    return sentinel.kind === 'approved'
      ? ok({ kind: 'approved' })
      : ok({ kind: 'changes', feedback: sentinel.feedback });
  }

  private async handleAttemptFailure(
    loop: LoopWithPhases,
    phase: LoopPhase,
    failures: Array<VerifierError | { kind: 'sentinel'; message: string }>
  ): Promise<
    Result<
      { kind: 'retry' } | { kind: 'failed'; loop: LoopWithPhases; phase: LoopPhase },
      LoopRunError
    >
  > {
    if (phase.attempts < MAX_PHASE_ATTEMPTS) {
      const updated = await this.transitionPhase(phase.id, {
        status: 'running',
        lastError: failureSummary(failures),
      });
      if (!updated.success) return err(updated.error);
      return ok({ kind: 'retry' });
    }

    return this.markPhaseAndLoopFailed(loop, phase, failureSummary(failures));
  }

  private async markPhaseAndLoopFailed(
    loop: LoopWithPhases,
    phase: LoopPhase,
    message: string
  ): Promise<Result<{ kind: 'failed'; loop: LoopWithPhases; phase: LoopPhase }, LoopRunError>> {
    const phaseResult = await this.transitionPhase(phase.id, {
      status: 'failed',
      lastError: message,
    });
    if (!phaseResult.success) return err(phaseResult.error);

    const loopResult = await this.transitionLoop(loop.id, { status: 'failed' });
    if (!loopResult.success) return err(loopResult.error);

    const reloaded = await this.deps.getLoop(loop.id);
    return ok({ kind: 'failed', loop: reloaded ?? loop, phase: phaseResult.data });
  }

  private async transitionLoop(
    loopId: string,
    patch: Parameters<PhaseRunnerDeps['updateLoop']>[1]
  ): Promise<Result<Loop, LoopRunError>> {
    const result = await this.deps.updateLoop(loopId, patch);
    if (!result.success) {
      return err({
        kind: 'operation-error',
        message: result.error.message,
        cause: result.error,
      });
    }
    this.deps.onLoopUpdated?.(result.data);
    return ok(result.data);
  }

  private async transitionPhase(
    phaseId: string,
    patch: Parameters<PhaseRunnerDeps['updatePhase']>[1]
  ): Promise<Result<LoopPhase, LoopRunError>> {
    const result = await this.deps.updatePhase(phaseId, patch);
    if (!result.success) {
      return err({
        kind: 'operation-error',
        message: result.error.message,
        cause: result.error,
      });
    }
    this.deps.onPhaseUpdated?.(result.data);
    return ok(result.data);
  }
}
