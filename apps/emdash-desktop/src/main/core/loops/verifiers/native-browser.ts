import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import { redactAll } from '@emdash/shared/logger';
import type { VerificationActionExecution } from '@main/core/browser/browser-webcontents-registry';
import type {
  NativeBrowserReconcileResult,
  NativeBrowserVerificationService,
  NativeBrowserVerificationSession,
} from '@main/core/browser/native-browser-verification-service';
import { err, ok, type Result } from '@main/lib/result';
import {
  LOOP_BROWSER_DISPOSABLE_PARTITION_PREFIX,
  loopBrowserActionResultSchema,
  loopBrowserClosedMessageSchema,
  loopBrowserLeaseSchema,
  type LoopBrowserAction,
  type LoopBrowserActionResult,
  type LoopBrowserLease,
  type LoopBrowserObservation,
} from '@shared/core/loops/loop-browser-contracts';
import { loopSessionTargetSchema, type LoopSessionTarget } from '@shared/core/loops/loop-state';
import type { Loop, LoopPhase } from '@shared/core/loops/loops';
import type { LoopSessionDriver, LoopSessionInfo } from '../drivers/session-driver';
import type {
  LoopEvidenceRunPort,
  LoopEvidenceRunStatus,
  LoopEvidenceStorePort,
} from '../evidence/loop-evidence-store';
import { serializePromptJson } from '../handoff-builder';
import { isSafeLoopSentinelDetail } from '../prompt-builder';
import {
  NATIVE_BROWSER_ACTION_BEGIN,
  nativeBrowserActionPromptFragment,
  parseNativeBrowserAction,
} from './native-browser-protocol';
import type { LoopVerifier, VerifierError, VerifierEvidence, VerifierRunContext } from './types';

const id = 'agent-browser' as const;
const label = 'Native Browser Preview';

const DEFAULT_NATIVE_BROWSER_TIMEOUT_MS = 15 * 60 * 1_000;
const MAX_NATIVE_BROWSER_ACTIONS = 128;
const MAX_TRUSTED_ENVIRONMENT_BYTES = 64 * 1024;
const TRUSTED_TASK_ENVIRONMENT_KEYS = [
  'EMDASH_DEFAULT_BRANCH',
  'EMDASH_PORT',
  'EMDASH_ROOT_PATH',
  'EMDASH_TASK_ID',
  'EMDASH_TASK_NAME',
  'EMDASH_TASK_PATH',
] as const;

export const NATIVE_BROWSER_PASSED_SENTINEL = '<<<LOOP:NATIVE_BROWSER_PASSED>>>';
export const NATIVE_BROWSER_FAILED_PREFIX = '<<<LOOP:NATIVE_BROWSER_FAILED';
export const NATIVE_BROWSER_CORRECTION_REQUIRED_PREFIX =
  '<<<LOOP:NATIVE_BROWSER_CORRECTION_REQUIRED';

const nativeBrowserTerminalPattern =
  /<<<LOOP:NATIVE_BROWSER_PASSED>>>|<<<LOOP:NATIVE_BROWSER_FAILED[ \t]+([^\r\n<>]+)>>>|<<<LOOP:NATIVE_BROWSER_CORRECTION_REQUIRED[ \t]+([^\r\n<>]+)>>>/gu;
const sensitiveTargetPattern = /password|passphrase|secret|token|authorization|api[_ -]?key/iu;

export type NativeBrowserTerminalOutcome =
  | { kind: 'passed' }
  | { kind: 'failed'; reason: string }
  | { kind: 'correction-required'; summary: string };

export type TrustedNativeBrowserBinding = {
  verificationRunId: string;
  target: LoopSessionTarget;
  taskEnvironment: Readonly<Record<string, string>>;
  previewServerId?: string;
};

export type NativeBrowserDependencyError = {
  kind: string;
  message: string;
};

export type NativeBrowserSessionHandle = LoopSessionInfo & {
  verificationRunId: string;
  target: LoopSessionTarget;
  driver: LoopSessionDriver;
};

export type NativeBrowserVerifierDependencies = {
  /** Read-only authority lookup. It must not acquire a runtime or persist environment values. */
  resolveTrustedBinding(input: {
    loop: Loop;
    phase: LoopPhase;
    signal: AbortSignal;
  }): Promise<Result<TrustedNativeBrowserBinding, NativeBrowserDependencyError>>;
  /**
   * Starts a fresh ACP session on the supplied target/env and echoes both so this verifier can
   * reject feature-task fallback before sending a prompt.
   */
  startVerificationSession(input: {
    loop: Loop;
    phase: LoopPhase;
    verificationRunId: string;
    target: LoopSessionTarget;
    taskEnvironment: Readonly<Record<string, string>>;
    signal: AbortSignal;
  }): Promise<Result<NativeBrowserSessionHandle, NativeBrowserDependencyError>>;
  browser: Pick<
    NativeBrowserVerificationService,
    'start' | 'performAction' | 'reconcilePreview' | 'close'
  >;
  evidenceStore: LoopEvidenceStorePort;
  idFactory?: () => string;
};

type NativeBrowserTurn =
  | { kind: 'action'; action: LoopBrowserAction }
  | { kind: 'terminal'; outcome: NativeBrowserTerminalOutcome };

type RotationObservation = {
  kind: 'lease-resumed' | 'lease-rotated';
  previousVerificationRunId: string;
  verificationRunId: string;
  workspaceId: string;
  allowedPreviewOrigin: string;
  actionReplayed: false;
};

class NativeBrowserVerifierFailure extends Error {
  constructor(
    readonly kind: VerifierError['kind'],
    message: string,
    readonly evidenceStatus: LoopEvidenceRunStatus = 'failed'
  ) {
    super(message);
  }
}

class NativeBrowserRunControl {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly timeout: ReturnType<typeof setTimeout>;
  private readonly callerSignal?: AbortSignal;
  private abortCause: 'timed-out' | 'aborted' | null = null;

  constructor(callerSignal: AbortSignal | undefined, timeoutMs: number) {
    this.signal = this.controller.signal;
    this.callerSignal = callerSignal;
    this.timeout = setTimeout(() => {
      if (this.abortCause !== null) return;
      this.abortCause = 'timed-out';
      this.controller.abort();
    }, timeoutMs);
    callerSignal?.addEventListener('abort', this.onCallerAbort, { once: true });
    if (callerSignal?.aborted) this.onCallerAbort();
  }

  get abortKind(): 'timed-out' | 'aborted' {
    return this.abortCause ?? 'aborted';
  }

  get abortMessage(): string {
    return this.abortCause === 'timed-out'
      ? 'Native browser verification timed out'
      : 'Native browser verification was cancelled';
  }

  get wasAborted(): boolean {
    return this.signal.aborted;
  }

  assertActive(): void {
    if (this.signal.aborted) {
      throw new NativeBrowserVerifierFailure(this.abortKind, this.abortMessage, 'cancelled');
    }
  }

  async wait<T>(promise: Promise<T>): Promise<T> {
    this.assertActive();
    return await new Promise<T>((resolvePromise, rejectPromise) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        this.signal.removeEventListener('abort', onAbort);
        callback();
      };
      const onAbort = () =>
        finish(() =>
          rejectPromise(
            new NativeBrowserVerifierFailure(this.abortKind, this.abortMessage, 'cancelled')
          )
        );
      this.signal.addEventListener('abort', onAbort, { once: true });
      void promise.then(
        (value) => finish(() => resolvePromise(value)),
        (error) => finish(() => rejectPromise(error))
      );
      if (this.signal.aborted) onAbort();
    });
  }

  dispose(): void {
    clearTimeout(this.timeout);
    this.callerSignal?.removeEventListener('abort', this.onCallerAbort);
  }

  private readonly onCallerAbort = (): void => {
    if (this.abortCause !== null) return;
    this.abortCause = 'aborted';
    clearTimeout(this.timeout);
    this.controller.abort();
  };
}

export function createNativeBrowserVerifier(
  dependencies: NativeBrowserVerifierDependencies
): LoopVerifier {
  const idFactory = dependencies.idFactory ?? randomUUID;
  return {
    id,
    label,
    async checkAvailability() {
      return ok({ available: true });
    },
    async run(ctx) {
      return await runNativeBrowserVerification(ctx, dependencies, idFactory);
    },
  };
}

async function runNativeBrowserVerification(
  ctx: VerifierRunContext,
  dependencies: NativeBrowserVerifierDependencies,
  idFactory: () => string
): Promise<Result<VerifierEvidence, VerifierError>> {
  const criteria = ctx.criteria.filter((criterion) => criterion.verifier === id);
  if (criteria.length === 0) {
    return err(
      verifierFailure('invalid-config', 'Native browser verification has no criteria', ctx.cwd)
    );
  }
  if (criteria.length > 64) {
    return err(
      verifierFailure(
        'invalid-config',
        'Native browser verification exceeds the bounded 64-criterion limit',
        ctx.cwd
      )
    );
  }

  const startedAt = Date.now();
  const timeoutMs = validTimeout(ctx.promptTimeoutMs);
  const control = new NativeBrowserRunControl(ctx.signal, timeoutMs);
  let binding: TrustedNativeBrowserBinding | null = null;
  let evidence: LoopEvidenceRunPort | null = null;
  let activeSession: NativeBrowserVerificationSession | null = null;
  let nestedSession: NativeBrowserSessionHandle | null = null;
  const leasesToClose: LoopBrowserLease[] = [];
  let evidenceStatus: LoopEvidenceRunStatus = 'failed';
  let finalSummary = 'Native browser verification failed';
  let command = 'ACP native browser verification';
  let result: Result<VerifierEvidence, VerifierError> | null = null;

  try {
    const resolved = await control.wait(
      dependencies.resolveTrustedBinding({
        loop: ctx.loop,
        phase: ctx.phase,
        signal: control.signal,
      })
    );
    if (!resolved.success) {
      throw new NativeBrowserVerifierFailure(
        'invalid-config',
        safeText(resolved.error.message, 'Trusted verification target is unavailable')
      );
    }
    binding = validateTrustedBinding(resolved.data, ctx);
    control.assertActive();
    const evidencePromise = dependencies.evidenceStore.beginRun({
      loopId: ctx.loop.id,
      phaseId: ctx.phase.id,
      verificationRunId: binding.verificationRunId,
    });
    try {
      evidence = await control.wait(evidencePromise);
    } catch (error) {
      if (control.wasAborted) {
        const lateEvidence = await settlePromise(evidencePromise);
        if (lateEvidence.success) {
          const finalized = await settlePromise(
            lateEvidence.value.finish({
              status: 'cancelled',
              summary: 'Verification cancelled before evidence start',
            })
          );
          if (!finalized.success) {
            evidence = lateEvidence.value;
          }
        }
      }
      throw error;
    }
    assertEvidenceOutsideRepositories(evidence.directory, ctx, binding.target);

    control.assertActive();
    const browserStartPromise = dependencies.browser.start({
      verificationRunId: binding.verificationRunId,
      projectId: ctx.loop.projectId,
      taskId: ctx.loop.taskId,
      workspaceId: binding.target.workspaceId,
      ...(binding.previewServerId ? { previewServerId: binding.previewServerId } : {}),
      signal: control.signal,
    });
    let browserStart: Awaited<typeof browserStartPromise>;
    try {
      browserStart = await control.wait(browserStartPromise);
    } catch (error) {
      if (control.wasAborted) {
        const lateStart = await settlePromise(browserStartPromise);
        if (lateStart.success && lateStart.value.success) {
          const lease = loopBrowserLeaseSchema.safeParse(lateStart.value.data?.lease);
          if (lease.success) leasesToClose.push(lease.data);
        }
      }
      throw error;
    }
    if (!browserStart.success) {
      const kind = browserStart.error.kind === 'cancelled' ? control.abortKind : 'command-failed';
      throw new NativeBrowserVerifierFailure(
        kind,
        safeText(browserStart.error.message, 'Native browser session failed to start'),
        browserStart.error.kind === 'cancelled' ? 'cancelled' : 'failed'
      );
    }
    const initialCandidateLease = loopBrowserLeaseSchema.safeParse(browserStart.data?.lease);
    if (initialCandidateLease.success) leasesToClose.push(initialCandidateLease.data);
    activeSession = validateInitialBrowserSession(browserStart.data, binding, ctx.loop);

    control.assertActive();
    const sessionPromise = dependencies.startVerificationSession({
      loop: ctx.loop,
      phase: ctx.phase,
      verificationRunId: binding.verificationRunId,
      target: cloneTarget(binding.target),
      taskEnvironment: { ...binding.taskEnvironment },
      signal: control.signal,
    });
    let session: Awaited<typeof sessionPromise>;
    try {
      session = await control.wait(sessionPromise);
    } catch (error) {
      if (control.wasAborted) {
        const lateSession = await settlePromise(sessionPromise);
        if (
          lateSession.success &&
          lateSession.value.success &&
          typeof lateSession.value.data?.conversationId === 'string' &&
          isLoopSessionDriver(lateSession.value.data.driver)
        ) {
          const lateDriver = lateSession.value.data.driver;
          const lateConversationId = lateSession.value.data.conversationId;
          const cancellation = await settlePromise(
            Promise.resolve().then(() => lateDriver.cancelPrompt(lateConversationId))
          );
          const cancellationError = !cancellation.success
            ? cancellation.error
            : !cancellation.value.success
              ? cancellation.value.error.message
              : null;
          if (cancellationError !== null) {
            throw new NativeBrowserVerifierFailure(
              'execution-error',
              `${control.abortMessage}\nCleanup recovery required: ${safeText(
                cancellationError,
                'Late native browser ACP cancellation was not acknowledged'
              )}`,
              'cancelled'
            );
          }
        }
      }
      throw error;
    }
    if (!session.success) {
      throw new NativeBrowserVerifierFailure(
        'command-failed',
        safeText(session.error.message, 'Native browser ACP session failed to start')
      );
    }
    nestedSession = validateNestedSession(session.data, binding, ctx.phase);
    command = `ACP native browser verification: ${safeText(nestedSession.title, 'verification')}`;
    if (ctx.setActiveConversation) {
      control.assertActive();
      let activationAccepted = false;
      const activationPromise = Promise.resolve(
        ctx.setActiveConversation(nestedSession.conversationId, nestedSession.driver)
      );
      try {
        await control.wait(activationPromise);
        activationAccepted = true;
      } catch (error) {
        if (control.wasAborted && !activationAccepted) {
          await settlePromise(activationPromise);
          await restoreOuterConversation(ctx);
        }
        throw error;
      }
    }

    let prompt = buildInitialPrompt(ctx, binding, activeSession);
    let successfulObservations = 0;
    const actionIds = new Set<string>();
    let finalText = '';

    for (let turnIndex = 0; turnIndex < MAX_NATIVE_BROWSER_ACTIONS + 1; turnIndex += 1) {
      const promptResult = await sendControlledPrompt(
        nestedSession.driver,
        nestedSession.conversationId,
        prompt,
        control
      );
      if (!promptResult.success) {
        throw new NativeBrowserVerifierFailure(
          control.wasAborted ? control.abortKind : 'command-failed',
          safeText(promptResult.error.message, 'Native browser ACP prompt failed'),
          control.wasAborted ? 'cancelled' : 'failed'
        );
      }
      finalText = promptResult.data.finalText;
      control.assertActive();
      const turn = parseNativeBrowserTurn(finalText);

      if (turn.kind === 'terminal') {
        if (turn.outcome.kind === 'passed') {
          if (successfulObservations === 0) {
            await control.wait(
              evidence.appendIntermediateFailure({
                kind: 'unobserved-pass',
                message:
                  'The nested verifier attempted to pass without a successful browser observation',
              })
            );
            throw new NativeBrowserVerifierFailure(
              'command-failed',
              'Native browser verifier reported pass without observing the browser'
            );
          }
          evidenceStatus = 'passed';
          finalSummary = terminalSummary(finalText, 'Native browser criteria passed');
          result = ok({
            verifierId: id,
            label,
            command,
            cwd: binding.target.path,
            durationMs: Date.now() - startedAt,
            stdoutTail: safeText(finalText, '', 4_000),
            stderrTail: '',
            exitCode: 0,
            summary: `${finalSummary}\n\nSensitive browser evidence is retained in app data.`,
            evidencePath: evidence.directory,
          });
          break;
        }
        if (turn.outcome.kind === 'correction-required') {
          evidenceStatus = 'correction-required';
          finalSummary = safeText(turn.outcome.summary, 'Browser correction is required');
          await control.wait(
            evidence.appendIntermediateFailure({
              kind: 'correction-required',
              message: finalSummary,
            })
          );
          throw new NativeBrowserVerifierFailure(
            'command-failed',
            `Native browser correction required: ${finalSummary}`,
            'correction-required'
          );
        }
        evidenceStatus = 'failed';
        finalSummary = safeText(turn.outcome.reason, 'Native browser criteria failed');
        await control.wait(
          evidence.appendIntermediateFailure({
            kind: 'terminal-failure',
            message: finalSummary,
          })
        );
        throw new NativeBrowserVerifierFailure('command-failed', finalSummary);
      }

      if (turnIndex >= MAX_NATIVE_BROWSER_ACTIONS) {
        throw new NativeBrowserVerifierFailure(
          'command-failed',
          `Native browser verification exceeded ${MAX_NATIVE_BROWSER_ACTIONS} actions`
        );
      }
      validateAction(turn.action, activeSession.lease);
      const actionId = uniqueActionId(idFactory, turnIndex, actionIds);
      control.assertActive();
      const actionPromise = dependencies.browser.performAction({
        type: 'action',
        ...activeSession.lease,
        actionId,
        action: turn.action,
      });
      let execution: VerificationActionExecution;
      try {
        execution = await control.wait(actionPromise);
      } catch (error) {
        if (control.wasAborted) {
          await Promise.all([
            settlePromise(dependencies.browser.close(activeSession.lease, 'cancelled')),
            settlePromise(actionPromise),
          ]);
        }
        throw error;
      }
      const safeResult = await validateAndStoreExecution(
        execution,
        turn.action,
        actionId,
        activeSession.lease,
        evidence,
        control
      );

      if (!safeResult.ok && safeResult.error.kind === 'not-ready') {
        control.assertActive();
        const reconcilePromise = dependencies.browser.reconcilePreview(activeSession.lease);
        let reconciled: Awaited<typeof reconcilePromise>;
        try {
          reconciled = await control.wait(reconcilePromise);
        } catch (error) {
          if (control.wasAborted) {
            const lateReconcile = await settlePromise(reconcilePromise);
            if (lateReconcile.success && lateReconcile.value.success) {
              registerReconciledCandidate(lateReconcile.value.data, leasesToClose);
            }
          }
          throw error;
        }
        if (!reconciled.success) {
          await control.wait(
            evidence.appendIntermediateFailure({
              kind: 'lease-reconcile',
              message: safeText(reconciled.error.message, 'Browser lease reconciliation failed'),
            })
          );
          throw new NativeBrowserVerifierFailure(
            'command-failed',
            safeText(reconciled.error.message, 'Browser lease reconciliation failed')
          );
        }
        const previousSession = activeSession;
        registerReconciledCandidate(reconciled.data, leasesToClose);
        if (reconciled.data.kind !== 'resumed' && reconciled.data.kind !== 'rotated') {
          throw new NativeBrowserVerifierFailure(
            'command-failed',
            'Native browser reconciliation returned an unknown session transition'
          );
        }
        activeSession = validateReconciledSession(
          reconciled.data,
          previousSession,
          binding,
          ctx.loop
        );
        const rotation: RotationObservation = {
          kind: reconciled.data.kind === 'rotated' ? 'lease-rotated' : 'lease-resumed',
          previousVerificationRunId: previousSession.lease.verificationRunId,
          verificationRunId: activeSession.lease.verificationRunId,
          workspaceId: activeSession.lease.workspaceId,
          allowedPreviewOrigin: activeSession.lease.allowedPreviewOrigin,
          actionReplayed: false,
        };
        if (reconciled.data.kind === 'rotated') {
          await control.wait(
            evidence.appendLeaseRotation({
              previousVerificationRunId: previousSession.lease.verificationRunId,
              verificationRunId: activeSession.lease.verificationRunId,
              previousOrigin: previousSession.lease.allowedPreviewOrigin,
              allowedPreviewOrigin: activeSession.lease.allowedPreviewOrigin,
            })
          );
        }
        prompt = buildObservationPrompt(actionId, turn.action.kind, rotation);
        continue;
      }

      if (
        !safeResult.ok &&
        (safeResult.error.kind === 'identity-mismatch' || safeResult.error.kind === 'lease-closed')
      ) {
        throw new NativeBrowserVerifierFailure('command-failed', safeResult.error.message);
      }
      if (safeResult.ok) successfulObservations += 1;
      prompt = buildObservationPrompt(actionId, turn.action.kind, safeResult);
    }

    if (!result) {
      throw new NativeBrowserVerifierFailure(
        'command-failed',
        'Native browser verification ended without a terminal outcome'
      );
    }
  } catch (error) {
    const failure = normalizeFailure(error, control);
    evidenceStatus = failure.evidenceStatus;
    finalSummary = failure.message;
    result = err(
      verifierFailure(
        failure.kind,
        failure.message,
        binding?.target.path ?? ctx.cwd,
        Date.now() - startedAt,
        command,
        evidence?.directory
      )
    );
  }

  const surfaceCleanupFailure = async (
    kind: string,
    message: string,
    recordInEvidence = true
  ): Promise<void> => {
    const cleanupMessage = safeText(message, 'Native browser cleanup failed');
    finalSummary = `${finalSummary}\nCleanup recovery required: ${cleanupMessage}`;
    if (evidenceStatus === 'passed') evidenceStatus = 'failed';
    result = err(
      verifierFailure(
        'execution-error',
        finalSummary,
        binding?.target.path ?? ctx.cwd,
        Date.now() - startedAt,
        command,
        evidence?.directory
      )
    );
    if (!recordInEvidence || !evidence) return;
    try {
      await evidence.appendIntermediateFailure({ kind, message: cleanupMessage });
    } catch (appendError) {
      const appendMessage = safeText(appendError, 'Failed to append cleanup recovery evidence');
      finalSummary = `${finalSummary}\nCleanup recovery required: ${appendMessage}`;
      result = err(
        verifierFailure(
          'execution-error',
          finalSummary,
          binding?.target.path ?? ctx.cwd,
          Date.now() - startedAt,
          command,
          evidence.directory
        )
      );
    }
  };

  const closeReason =
    evidenceStatus === 'passed'
      ? 'completed'
      : evidenceStatus === 'cancelled'
        ? 'cancelled'
        : 'failed';
  const cleanupErrors = await closeBrowserSessions(
    dependencies.browser,
    leasesToClose,
    closeReason
  );
  if (cleanupErrors.length > 0) {
    await surfaceCleanupFailure('browser-cleanup', cleanupErrors.join('; '));
  }

  if (nestedSession) {
    try {
      await restoreOuterConversation(ctx);
    } catch (error) {
      await surfaceCleanupFailure(
        'conversation-restore',
        safeText(error, 'Failed to restore the Loop conversation')
      );
    }
  }

  if (evidence) {
    try {
      await evidence.finish({ status: evidenceStatus, summary: finalSummary });
    } catch (error) {
      await surfaceCleanupFailure(
        'evidence-finalize',
        safeText(error, 'Failed to finalize native browser evidence'),
        false
      );
    }
  }
  control.dispose();

  return (
    result ??
    err(
      verifierFailure(
        'execution-error',
        'Native browser verification produced no result',
        binding?.target.path ?? ctx.cwd,
        Date.now() - startedAt,
        command,
        evidence?.directory
      )
    )
  );
}

export function parseNativeBrowserTerminal(text: string): NativeBrowserTerminalOutcome | null {
  const rawCandidates = Array.from(
    text.matchAll(/<<<LOOP:NATIVE_BROWSER_(?:PASSED|FAILED|CORRECTION_REQUIRED)/gu)
  );
  if (rawCandidates.length !== 1) return null;
  const matches = Array.from(text.matchAll(nativeBrowserTerminalPattern));
  if (matches.length !== 1) return null;
  const finalLine = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (finalLine !== matches[0]?.[0]) return null;
  if (matches[0][0] === NATIVE_BROWSER_PASSED_SENTINEL) return { kind: 'passed' };
  if (matches[0][1] !== undefined) {
    if (!isSafeLoopSentinelDetail(matches[0][1])) return null;
    return { kind: 'failed', reason: matches[0][1].trim() };
  }
  const correction = matches[0][2] ?? '';
  if (!isSafeLoopSentinelDetail(correction)) return null;
  return { kind: 'correction-required', summary: correction.trim() };
}

function parseNativeBrowserTurn(text: string): NativeBrowserTurn {
  const hasTerminalCandidate = /<<<LOOP:NATIVE_BROWSER_(?!ACTION)/u.test(text);
  const hasActionCandidate = text.includes(NATIVE_BROWSER_ACTION_BEGIN);
  if (hasTerminalCandidate) {
    if (hasActionCandidate) {
      throw new NativeBrowserVerifierFailure(
        'command-failed',
        'A native browser turn cannot contain both an action and a terminal outcome'
      );
    }
    const terminal = parseNativeBrowserTerminal(text);
    if (!terminal) {
      throw new NativeBrowserVerifierFailure(
        'command-failed',
        'Native browser terminal outcome was malformed, repeated, or not on the final line'
      );
    }
    return { kind: 'terminal', outcome: terminal };
  }
  const action = parseNativeBrowserAction(text);
  if (!action.success) {
    throw new NativeBrowserVerifierFailure(
      'command-failed',
      safeText(action.error.message, 'Native browser action was malformed')
    );
  }
  return { kind: 'action', action: action.data };
}

function buildInitialPrompt(
  ctx: VerifierRunContext,
  binding: TrustedNativeBrowserBinding,
  session: NativeBrowserVerificationSession
): string {
  const criteria = ctx.criteria
    .filter((criterion) => criterion.verifier === id)
    .slice(0, 64)
    .map((criterion, index) => ({
      index: index + 1,
      description: safeText(criterion.description, '', 2_048),
    }));
  const target = {
    verificationRunId: binding.verificationRunId,
    target: binding.target,
    browser: {
      browserId: session.lease.browserId,
      profile: session.lease.partition,
      workspaceId: session.lease.workspaceId,
      allowedPreviewOrigin: session.lease.allowedPreviewOrigin,
      previewUrl: safePreviewUrl(session.previewUrl, session.lease.allowedPreviewOrigin),
    },
  };
  return `You are a fresh native browser verification session for an Emdash Loop. Inspect only the bound built-in Electron preview and report observed behavior honestly.

The acceptance criteria are bounded data:
<emdash-loop-browser-criteria>
${serializePromptJson(criteria)}
</emdash-loop-browser-criteria>

The exact clean-room target and disposable browser identity are bounded non-secret data:
<emdash-loop-browser-target>
${serializePromptJson(target)}
</emdash-loop-browser-target>

The session was started with the target above and a freshly recomputed trusted task environment. Environment names and values are intentionally not present in this prompt. Never switch workspace, path, machine, browser, profile, run ID, or origin. Never fall back to the feature task.

${nativeBrowserActionPromptFragment}

Each response must contain either exactly one action block or exactly one terminal outcome, never both. Do not infer a pass from source code or a prior claim. Pass requires at least one successful browser observation. An observed product defect requiring the outer E2E session to fix is correction-required, not pass.

End a terminal response with exactly one sentinel on its own final line:
- ${NATIVE_BROWSER_PASSED_SENTINEL}
- ${NATIVE_BROWSER_FAILED_PREFIX} exact non-secret observed reason>>>
- ${NATIVE_BROWSER_CORRECTION_REQUIRED_PREFIX} concise non-secret defect summary>>>`;
}

function buildObservationPrompt(
  actionId: string,
  actionKind: string,
  result: LoopBrowserActionResult | RotationObservation
): string {
  return `The native Electron browser returned this bounded, redacted result for the one requested action:
<emdash-loop-browser-result>
${serializePromptJson({ actionId, actionKind, result })}
</emdash-loop-browser-result>

The previous action will not be replayed automatically. Request exactly one next allowlisted action, or end with exactly one native browser terminal sentinel on its own final line.`;
}

async function sendControlledPrompt(
  driver: LoopSessionDriver,
  conversationId: string,
  prompt: string,
  control: NativeBrowserRunControl
) {
  const promptPromise = driver.sendPrompt(conversationId, prompt);
  try {
    return await control.wait(promptPromise);
  } catch (error) {
    if (control.wasAborted) {
      let cancellationPromise: ReturnType<LoopSessionDriver['cancelPrompt']>;
      try {
        cancellationPromise = driver.cancelPrompt(conversationId);
      } catch (cancellationError) {
        cancellationPromise = Promise.reject(cancellationError);
      }
      const [cancellation, promptSettlement] = await Promise.all([
        settlePromise(cancellationPromise),
        settlePromise(promptPromise),
      ]);
      if (!cancellation.success || (cancellation.value && !cancellation.value.success)) {
        throw new NativeBrowserVerifierFailure(
          control.abortKind,
          `${control.abortMessage}; nested ACP cancellation was not acknowledged`,
          'cancelled'
        );
      }
      if (!promptSettlement.success) {
        throw new NativeBrowserVerifierFailure(
          control.abortKind,
          control.abortMessage,
          'cancelled'
        );
      }
    }
    throw error;
  }
}

async function settlePromise<T>(
  promise: Promise<T>
): Promise<{ success: true; value: T } | { success: false; error: unknown }> {
  try {
    return { success: true, value: await promise };
  } catch (error) {
    return { success: false, error };
  }
}

async function restoreOuterConversation(ctx: VerifierRunContext): Promise<void> {
  if (!ctx.setActiveConversation) return;
  await ctx.setActiveConversation(
    ctx.phase.conversationId,
    ctx.phase.conversationId ? (ctx.sessionDriver ?? null) : null
  );
}

function validateTrustedBinding(
  value: TrustedNativeBrowserBinding,
  ctx: VerifierRunContext
): TrustedNativeBrowserBinding {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof value.verificationRunId !== 'string' ||
    value.verificationRunId.trim().length === 0 ||
    value.verificationRunId.length > 256
  ) {
    throw new NativeBrowserVerifierFailure(
      'invalid-config',
      'Trusted browser verification run identity is missing or invalid'
    );
  }
  const target = loopSessionTargetSchema.safeParse(value.target);
  if (!target.success) {
    throw new NativeBrowserVerifierFailure(
      'invalid-config',
      'Native browser verification requires an explicit clean-room session target'
    );
  }
  const taskEnvironment = validateTrustedEnvironment(value.taskEnvironment);
  if (!ctx.executionTarget) {
    throw new NativeBrowserVerifierFailure(
      'invalid-config',
      'Native browser verification requires an authoritative execution target'
    );
  }
  if (!sameTarget(ctx.executionTarget, target.data)) {
    throw new NativeBrowserVerifierFailure(
      'invalid-config',
      'Native browser target does not match the authoritative verifier execution target'
    );
  }
  if (!sameStringRecord(ctx.executionTarget.taskEnv, taskEnvironment)) {
    throw new NativeBrowserVerifierFailure(
      'invalid-config',
      'Native browser task environment does not match the authoritative verifier environment'
    );
  }
  if (taskEnvironment.EMDASH_TASK_PATH !== target.data.path) {
    throw new NativeBrowserVerifierFailure(
      'invalid-config',
      'Trusted task environment path does not match the clean-room target'
    );
  }
  return {
    verificationRunId: value.verificationRunId,
    target: cloneTarget(target.data),
    taskEnvironment,
    ...(value.previewServerId ? { previewServerId: boundedId(value.previewServerId) } : {}),
  };
}

function validateTrustedEnvironment(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new NativeBrowserVerifierFailure(
      'invalid-config',
      'Native browser verification requires a recomputed trusted task environment'
    );
  }
  const entries = Object.entries(value);
  const keys = entries.map(([key]) => key).sort();
  if (
    keys.length !== TRUSTED_TASK_ENVIRONMENT_KEYS.length ||
    keys.some((key, index) => key !== TRUSTED_TASK_ENVIRONMENT_KEYS[index])
  ) {
    throw new NativeBrowserVerifierFailure(
      'invalid-config',
      'Trusted task environment must contain only the exact recomputed task-variable allowlist'
    );
  }
  let byteLength = 0;
  const environment: Record<string, string> = {};
  for (const [key, entryValue] of entries) {
    if (typeof entryValue !== 'string') {
      throw new NativeBrowserVerifierFailure(
        'invalid-config',
        'Trusted task environment may contain only recomputed string values'
      );
    }
    byteLength += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(entryValue, 'utf8');
    if (entryValue.length > 4_096 || byteLength > MAX_TRUSTED_ENVIRONMENT_BYTES) {
      throw new NativeBrowserVerifierFailure(
        'invalid-config',
        'Trusted task environment exceeds its bounded size'
      );
    }
    environment[key] = entryValue;
  }
  return Object.freeze(environment);
}

function validateInitialBrowserSession(
  session: NativeBrowserVerificationSession,
  binding: TrustedNativeBrowserBinding,
  loop: Loop
): NativeBrowserVerificationSession {
  const validated = validateBrowserSession(session, binding.target, loop);
  if (validated.lease.verificationRunId !== binding.verificationRunId) {
    throw new NativeBrowserVerifierFailure(
      'command-failed',
      'Native browser service returned the wrong verification run identity'
    );
  }
  if (binding.previewServerId && validated.previewServerId !== binding.previewServerId) {
    throw new NativeBrowserVerifierFailure(
      'command-failed',
      'Native browser service changed the selected preview association'
    );
  }
  return validated;
}

function validateNestedSession(
  session: NativeBrowserSessionHandle,
  binding: TrustedNativeBrowserBinding,
  phase: LoopPhase
): NativeBrowserSessionHandle {
  const target = loopSessionTargetSchema.safeParse(session?.target);
  if (
    typeof session !== 'object' ||
    session === null ||
    session.verificationRunId !== binding.verificationRunId ||
    !target.success ||
    !sameTarget(target.data, binding.target)
  ) {
    throw new NativeBrowserVerifierFailure(
      'command-failed',
      'Nested browser session did not retain the exact clean-room target and run identity'
    );
  }
  if (
    typeof session.conversationId !== 'string' ||
    session.conversationId.trim().length === 0 ||
    session.conversationId.length > 256 ||
    session.conversationId === phase.conversationId
  ) {
    throw new NativeBrowserVerifierFailure(
      'command-failed',
      'Nested browser verification requires a fresh bounded conversation identity'
    );
  }
  if (
    typeof session.title !== 'string' ||
    session.title.trim().length === 0 ||
    session.title.length > 512 ||
    !isLoopSessionDriver(session.driver) ||
    session.driver.kind !== 'acp'
  ) {
    throw new NativeBrowserVerifierFailure(
      'command-failed',
      'Nested browser verification requires a fresh ACP session driver'
    );
  }
  return {
    verificationRunId: session.verificationRunId,
    target: cloneTarget(target.data),
    conversationId: session.conversationId,
    title: session.title,
    driver: session.driver,
  };
}

function validateBrowserSession(
  session: NativeBrowserVerificationSession,
  target: LoopSessionTarget,
  loop: Loop
): NativeBrowserVerificationSession {
  const lease = loopBrowserLeaseSchema.safeParse(session?.lease);
  if (!lease.success) {
    throw new NativeBrowserVerifierFailure(
      'command-failed',
      'Native browser service returned an invalid disposable lease'
    );
  }
  if (
    lease.data.projectId !== loop.projectId ||
    lease.data.taskId !== loop.taskId ||
    lease.data.workspaceId !== target.workspaceId ||
    !lease.data.partition.startsWith(LOOP_BROWSER_DISPOSABLE_PARTITION_PREFIX)
  ) {
    throw new NativeBrowserVerifierFailure(
      'command-failed',
      'Native browser lease identity does not match the clean-room target'
    );
  }
  if (
    typeof session.previewServerId !== 'string' ||
    session.previewServerId.trim().length === 0 ||
    typeof session.previewUrl !== 'string'
  ) {
    throw new NativeBrowserVerifierFailure(
      'command-failed',
      'Native browser service returned incomplete preview authority'
    );
  }
  safePreviewUrl(session.previewUrl, lease.data.allowedPreviewOrigin);
  return {
    lease: { ...lease.data },
    previewServerId: boundedId(session.previewServerId),
    previewUrl: session.previewUrl,
  };
}

function validateReconciledSession(
  reconciled: NativeBrowserReconcileResult,
  previous: NativeBrowserVerificationSession,
  binding: TrustedNativeBrowserBinding,
  loop: Loop
): NativeBrowserVerificationSession {
  const next = validateBrowserSession(reconciled.session, binding.target, loop);
  if (reconciled.kind === 'resumed') {
    if (!sameLease(previous.lease, next.lease)) {
      throw new NativeBrowserVerifierFailure(
        'command-failed',
        'A resumed native browser session changed lease identity'
      );
    }
    return next;
  }
  if (reconciled.kind !== 'rotated') {
    throw new NativeBrowserVerifierFailure(
      'command-failed',
      'Native browser reconciliation returned an unknown session transition'
    );
  }
  if (
    next.lease.verificationRunId === previous.lease.verificationRunId ||
    next.lease.browserId === previous.lease.browserId ||
    next.lease.partition === previous.lease.partition ||
    next.lease.allowedPreviewOrigin === previous.lease.allowedPreviewOrigin ||
    next.previewServerId !== previous.previewServerId
  ) {
    throw new NativeBrowserVerifierFailure(
      'command-failed',
      'A rotated native browser session reused the previous lease identity'
    );
  }
  return next;
}

function registerReconciledCandidate(value: unknown, leases: LoopBrowserLease[]): void {
  if (typeof value !== 'object' || value === null || !('session' in value)) return;
  const session = (value as { session?: unknown }).session;
  if (typeof session !== 'object' || session === null || !('lease' in session)) return;
  const lease = loopBrowserLeaseSchema.safeParse((session as { lease?: unknown }).lease);
  if (lease.success) leases.push(lease.data);
}

function validateAction(action: LoopBrowserAction, lease: LoopBrowserLease): void {
  if (action.kind === 'navigate') {
    let url: URL;
    try {
      url = new URL(action.url);
    } catch {
      throw new NativeBrowserVerifierFailure('command-failed', 'Browser navigation URL is invalid');
    }
    if (
      url.origin !== lease.allowedPreviewOrigin ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      throw new NativeBrowserVerifierFailure(
        'command-failed',
        'Browser navigation must stay on the exact allowed origin without credentials, query, or hash'
      );
    }
  }
  if (action.kind === 'fill') {
    const targetText = [action.target.role, action.target.name, action.target.testId]
      .filter(Boolean)
      .join(' ');
    if (
      sensitiveTargetPattern.test(targetText) ||
      redactAll(action.value) !== action.value ||
      sensitiveTargetPattern.test(action.value)
    ) {
      throw new NativeBrowserVerifierFailure(
        'command-failed',
        'Native browser verification refuses sensitive fill input'
      );
    }
  }
}

async function validateAndStoreExecution(
  execution: VerificationActionExecution,
  action: LoopBrowserAction,
  actionId: string,
  lease: LoopBrowserLease,
  evidence: LoopEvidenceRunPort,
  control: NativeBrowserRunControl
): Promise<LoopBrowserActionResult> {
  const parsed = loopBrowserActionResultSchema.safeParse(execution?.result);
  if (!parsed.success) {
    throw new NativeBrowserVerifierFailure(
      'execution-error',
      'Native browser service returned an invalid bounded observation'
    );
  }
  const result = sanitizeActionResult(parsed.data, lease.allowedPreviewOrigin);
  if (result.ok) validateObservationKind(action, result.observation);
  if (action.kind === 'screenshot' && result.ok) {
    if (result.observation.kind !== 'screenshot' || !execution.screenshot) {
      throw new NativeBrowserVerifierFailure(
        'execution-error',
        'Native browser screenshot result omitted its sensitive artifact bytes'
      );
    }
    if (
      execution.screenshot.artifactId !== result.observation.artifact.artifactId ||
      execution.screenshot.mimeType !== result.observation.artifact.mimeType ||
      execution.screenshot.data.byteLength !== result.observation.artifact.byteLength
    ) {
      throw new NativeBrowserVerifierFailure(
        'execution-error',
        'Native browser screenshot metadata did not match its sensitive artifact'
      );
    }
    await control.wait(evidence.writeScreenshot(execution.screenshot));
  } else if (execution.screenshot) {
    throw new NativeBrowserVerifierFailure(
      'execution-error',
      'Native browser service attached screenshot bytes to a non-screenshot action'
    );
  }
  await control.wait(evidence.appendObservation({ actionId, actionKind: action.kind, result }));
  if (!result.ok) {
    await control.wait(
      evidence.appendIntermediateFailure({
        kind: `browser-${result.error.kind}`,
        message: result.error.message,
      })
    );
  }
  return result;
}

function validateObservationKind(
  action: LoopBrowserAction,
  observation: LoopBrowserObservation
): void {
  const expectedKind =
    action.kind === 'navigate'
      ? 'navigation'
      : action.kind === 'accessibility-snapshot'
        ? 'accessibility-snapshot'
        : action.kind === 'accessibility-query'
          ? 'accessibility-query'
          : action.kind === 'diagnostics'
            ? 'diagnostics'
            : action.kind === 'screenshot'
              ? 'screenshot'
              : 'interaction';
  if (observation.kind !== expectedKind) {
    throw new NativeBrowserVerifierFailure(
      'execution-error',
      `Native browser returned ${observation.kind} evidence for ${action.kind}; expected ${expectedKind}`
    );
  }
}

function sanitizeActionResult(
  result: LoopBrowserActionResult,
  allowedOrigin: string
): LoopBrowserActionResult {
  if (!result.ok) {
    return {
      ok: false,
      error: {
        kind: result.error.kind,
        message: safeText(result.error.message, 'Browser action failed', 2_048),
      },
    };
  }
  return { ok: true, observation: sanitizeObservation(result.observation, allowedOrigin) };
}

function sanitizeObservation(
  observation: LoopBrowserObservation,
  allowedOrigin: string
): LoopBrowserObservation {
  switch (observation.kind) {
    case 'navigation':
      return {
        kind: observation.kind,
        currentUrl: safePreviewUrl(observation.currentUrl, allowedOrigin),
        ...(observation.title ? { title: safeText(observation.title, '', 512) } : {}),
      };
    case 'interaction':
      return {
        kind: observation.kind,
        currentUrl: safePreviewUrl(observation.currentUrl, allowedOrigin),
      };
    case 'accessibility-snapshot':
      return {
        kind: observation.kind,
        snapshot: safeText(observation.snapshot, '', 65_536),
        truncated: observation.truncated,
      };
    case 'accessibility-query':
      return {
        kind: observation.kind,
        matches: observation.matches.slice(0, 50).map((match) => ({
          nodeId: safeText(match.nodeId, '', 256),
          role: safeText(match.role, '', 64),
          name: safeText(match.name, '', 512),
          ...(match.value !== undefined ? { value: safeText(match.value, '', 2_048) } : {}),
          ...(match.disabled !== undefined ? { disabled: match.disabled } : {}),
        })),
        truncated: observation.truncated || observation.matches.length > 50,
      };
    case 'screenshot':
      return {
        kind: observation.kind,
        artifact: { ...observation.artifact },
      };
    case 'diagnostics':
      return {
        kind: observation.kind,
        entries: observation.entries.slice(0, 50).map((entry) => ({
          level: entry.level,
          source: entry.source,
          message: safeText(entry.message, '', 2_048),
          redacted: true,
        })),
        truncated: observation.truncated || observation.entries.length > 50,
      };
  }
}

async function closeBrowserSessions(
  browser: NativeBrowserVerifierDependencies['browser'],
  leases: LoopBrowserLease[],
  reason: 'completed' | 'failed' | 'cancelled'
): Promise<string[]> {
  const errors: string[] = [];
  const closed = new Set<string>();
  for (const lease of [...leases].reverse()) {
    const key = leaseKey(lease);
    if (closed.has(key)) continue;
    closed.add(key);
    try {
      const result = await browser.close(lease, reason);
      const parsed = loopBrowserClosedMessageSchema.safeParse(result);
      if (!parsed.success || !sameLease(lease, parsed.data)) {
        errors.push('Native browser cleanup returned the wrong lease identity');
      } else if (!parsed.data.partitionDataCleared || parsed.data.cleanupError) {
        errors.push(parsed.data.cleanupError ?? 'Native browser partition data was not cleared');
      }
    } catch (error) {
      errors.push(safeText(error, 'Native browser cleanup failed'));
    }
  }
  return errors;
}

function uniqueActionId(idFactory: () => string, turnIndex: number, used: Set<string>): string {
  const generated = safeIdentifier(idFactory());
  const actionId = `${turnIndex + 1}-${generated}`.slice(0, 256);
  if (used.has(actionId)) {
    throw new NativeBrowserVerifierFailure(
      'execution-error',
      'Native browser action identity was reused'
    );
  }
  used.add(actionId);
  return actionId;
}

function safePreviewUrl(value: string, allowedOrigin: string): string {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.origin !== allowedOrigin
    ) {
      throw new Error('origin mismatch');
    }
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 2_048);
  } catch {
    throw new NativeBrowserVerifierFailure(
      'command-failed',
      'Native browser URL did not match the exact allowed preview origin'
    );
  }
}

function assertEvidenceOutsideRepositories(
  evidenceDirectory: string,
  ctx: VerifierRunContext,
  target: LoopSessionTarget
): void {
  if (!isAbsolute(evidenceDirectory)) {
    throw new NativeBrowserVerifierFailure(
      'invalid-config',
      'Native browser evidence store did not return an absolute app-data path'
    );
  }
  if (isWithinPath(ctx.cwd, evidenceDirectory)) {
    throw new NativeBrowserVerifierFailure(
      'invalid-config',
      'Native browser evidence must not be stored in the feature repository'
    );
  }
  if (target.machine.kind === 'local' && isWithinPath(target.path, evidenceDirectory)) {
    throw new NativeBrowserVerifierFailure(
      'invalid-config',
      'Native browser evidence must not be stored in the verification repository'
    );
  }
}

function isWithinPath(parent: string, candidate: string): boolean {
  const fromParent = relative(resolve(parent), resolve(candidate));
  return fromParent === '' || (!fromParent.startsWith('..') && !isAbsolute(fromParent));
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

function sameStringRecord(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>
): boolean {
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey)
  );
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey)
  );
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([key, value], index) =>
        key === rightEntries[index]?.[0] && value === rightEntries[index]?.[1]
    )
  );
}

function isLoopSessionDriver(value: unknown): value is LoopSessionDriver {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<LoopSessionDriver>;
  return (
    (candidate.kind === 'acp' || candidate.kind === 'pty') &&
    typeof candidate.startPhaseSession === 'function' &&
    typeof candidate.startVerificationSession === 'function' &&
    typeof candidate.sendPrompt === 'function' &&
    typeof candidate.cancelPrompt === 'function'
  );
}

function cloneTarget(target: LoopSessionTarget): LoopSessionTarget {
  return {
    workspaceId: target.workspaceId,
    path: target.path,
    machine:
      target.machine.kind === 'local'
        ? { kind: 'local' }
        : { kind: 'ssh', connectionId: target.machine.connectionId },
  };
}

function sameLease(left: LoopBrowserLease, right: LoopBrowserLease): boolean {
  return (
    left.verificationRunId === right.verificationRunId &&
    left.browserId === right.browserId &&
    left.projectId === right.projectId &&
    left.taskId === right.taskId &&
    left.workspaceId === right.workspaceId &&
    left.partition === right.partition &&
    left.allowedPreviewOrigin === right.allowedPreviewOrigin
  );
}

function leaseKey(lease: LoopBrowserLease): string {
  return [
    lease.verificationRunId,
    lease.browserId,
    lease.projectId,
    lease.taskId,
    lease.workspaceId,
    lease.partition,
    lease.allowedPreviewOrigin,
  ].join('\u0000');
}

function normalizeFailure(
  error: unknown,
  control: NativeBrowserRunControl
): NativeBrowserVerifierFailure {
  if (error instanceof NativeBrowserVerifierFailure) return error;
  if (control.wasAborted) {
    return new NativeBrowserVerifierFailure(control.abortKind, control.abortMessage, 'cancelled');
  }
  return new NativeBrowserVerifierFailure(
    'execution-error',
    safeText(error, 'Native browser verification failed unexpectedly')
  );
}

function verifierFailure(
  kind: VerifierError['kind'],
  message: string,
  cwd: string,
  durationMs?: number,
  command?: string,
  evidencePath?: string
): VerifierError {
  return {
    kind,
    verifierId: id,
    message: safeText(message, 'Native browser verification failed'),
    cwd,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(command ? { command } : {}),
    ...(evidencePath ? { evidencePath } : {}),
  };
}

function terminalSummary(finalText: string, fallback: string): string {
  const withoutSentinel = finalText.replace(nativeBrowserTerminalPattern, '').trim();
  return safeText(withoutSentinel, fallback, 4_000) || fallback;
}

function safeText(value: unknown, fallback: string, limit = 4_096): string {
  const raw =
    typeof value === 'string'
      ? value
      : value instanceof Error
        ? value.message
        : typeof value === 'object' && value !== null && 'message' in value
          ? String((value as { message?: unknown }).message ?? '')
          : '';
  const redacted = redactAll(stripUrlDetails(raw.slice(0, limit * 4)))
    .slice(0, limit)
    .trim();
  return redacted || fallback;
}

function stripUrlDetails(value: string): string {
  return value.replace(/\b[a-z][a-z0-9+.-]*:[^\s<>"']+/giu, (candidate) => {
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '[REDACTED_URL]';
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      return '[REDACTED_URL]';
    }
  });
}

function safeIdentifier(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) return randomUUID();
  return value.replace(/[^a-zA-Z0-9_-]+/gu, '_').slice(0, 220) || randomUUID();
}

function boundedId(value: string): string {
  if (value.trim().length === 0 || value.length > 256) {
    throw new NativeBrowserVerifierFailure(
      'command-failed',
      'Native browser service returned an invalid bounded identifier'
    );
  }
  return value;
}

function validTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_NATIVE_BROWSER_TIMEOUT_MS;
  return Number.isFinite(value) && value > 0
    ? Math.min(value, 24 * 60 * 60 * 1_000)
    : DEFAULT_NATIVE_BROWSER_TIMEOUT_MS;
}
