import { err, ok, type Result } from '@main/lib/result';
import type { Loop, LoopPhase, LoopPhaseCriteria, LoopWithPhases } from '@shared/core/loops/loops';
import {
  resolvePromptTimeoutMs,
  safeMessage,
  sendPromptWithTimeout,
} from './drivers/prompt-timeout';
import type { LoopSessionDriver } from './drivers/session-driver';
import {
  getLoop,
  updateLoop as updateLoopRow,
  updatePhase as updatePhaseRow,
} from './operations/loop-operations';
import type { LoopOperationError } from './operations/types';
import {
  buildPhasePrompt,
  buildRetryPrompt,
  buildReviewPrompt,
  parsePhaseSentinel,
  parseReviewSentinel,
  PHASE_DONE_SENTINEL,
  REVIEW_APPROVED_SENTINEL,
} from './prompt-builder';
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
  onLoopUpdated?(loop: Loop): void;
  onPhaseUpdated?(phase: LoopPhase): void;
};

export type RunPhaseInput = {
  loop: LoopWithPhases;
  phase: LoopPhase;
  cwd: string;
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
        const session = await input.driver.startPhaseSession({ loop, phase, review: false });
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
        input.cwd,
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

      if (loop.config?.reviewEnabled) {
        const review = await this.runReviewGate(
          loop,
          phase,
          input.cwd,
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

  private async runVerifierGate(
    loop: Loop,
    phase: LoopPhase,
    cwd: string,
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
    driver: LoopSessionDriver,
    control: LoopRunControl
  ): Promise<Result<{ kind: 'approved' } | { kind: 'changes'; feedback: string }, LoopRunError>> {
    const reviewing = await this.transitionPhase(phase.id, { status: 'reviewing' });
    if (!reviewing.success) return err(reviewing.error);
    phase = reviewing.data;

    const session = await driver.startPhaseSession({ loop, phase, review: true });
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
