import { redactAll } from '@emdash/shared/logger';
import { err, ok, type Result } from '@main/lib/result';
import {
  loopArtifactReferenceSchema,
  type LoopArtifactReference,
} from '@shared/core/loops/loop-phase-state';
import {
  loopCommitSchema,
  loopSessionAttemptSchema,
  loopSessionTargetSchema,
  type LoopSessionAttempt,
  type LoopSessionTarget,
} from '@shared/core/loops/loop-state';
import {
  loopPhaseCriterionSchema,
  newLoopConfigV2Schema,
  type Loop,
  type NewLoopConfigV2,
  type LoopPhase,
  type LoopPhaseCriterion,
  type LoopProviderId,
} from '@shared/core/loops/loops';
import type { LoopSessionDriver } from '../drivers/session-driver';
import type {
  LoopEvidenceRunPort,
  LoopEvidenceRunStatus,
  LoopEvidenceStorePort,
} from '../evidence/loop-evidence-store';
import { buildLoopPhaseHandoff, type LoopPromptHandoff } from '../handoff-builder';
import type { LoopExecutionTarget } from '../runtime/loop-execution-target';
import {
  type NativeBrowserDependencyError,
  type NativeBrowserSessionHandle,
  type NativeBrowserVerifierDependencies,
} from './native-browser';
import type { LoopVerifier, VerifierError, VerifierRunContext } from './types';

const MAX_ID_LENGTH = 256;
const MAX_MODEL_LENGTH = 256;
const MAX_SUMMARY_LENGTH = 16_384;
const MAX_ARTIFACTS = 64;
const cookieAssignmentPattern =
  /\b(?:cookies?|set[_ -]?cookie|session[_ -]?(?:cookie|id)|sessionid)\b[\\'"\s]*[:=][\s\S]*/giu;
const posixAbsolutePathPattern = /(^|[\s("'=])\/(?:[^\s"'<>]|\\ )+/gmu;
const windowsAbsolutePathPattern = /\b[A-Z]:\\(?:[^\s"'<>]|\\ )+/giu;

export type NativeBrowserE2EAttestationStatus = 'passed' | 'correctable' | 'failed';

export type NativeBrowserE2ESessionIdentity = {
  attemptId: string;
  conversationId: string;
};

export type NativeBrowserE2EAttestationInput = {
  loop: Loop;
  phase: LoopPhase;
  verificationRunId: string;
  sessionIdentity: NativeBrowserE2ESessionIdentity;
  outerConversationId: string;
  target: LoopSessionTarget;
  executionTarget: LoopExecutionTarget;
  taskEnvironment: Readonly<Record<string, string>>;
  provider: LoopProviderId;
  model: string;
  checkpointCommit: string;
  criteria: readonly LoopPhaseCriterion[];
  signal?: AbortSignal;
  deadlineAt?: number;
};

export type NativeBrowserE2EAttestation = {
  status: NativeBrowserE2EAttestationStatus;
  summary: string;
  invocationCount: 1;
  passed: boolean;
  verificationRunId: string;
  target: LoopSessionTarget;
  taskEnvironment: Readonly<Record<string, string>>;
  provider: LoopProviderId;
  model: string;
  checkpointCommit: string;
  sessionAttempt: LoopSessionAttempt;
  evidence: {
    runId: string;
    artifacts: readonly LoopArtifactReference[];
  };
  handoff?: LoopPromptHandoff;
  quiescent: true;
};

export type NativeBrowserE2EAttestationError = {
  type: string;
  message: string;
  quiescent: true;
  sessionAttempts?: readonly LoopSessionAttempt[];
};

export type NativeBrowserE2EExactSessionInput = {
  loop: Loop;
  phase: LoopPhase;
  sessionIdentity: NativeBrowserE2ESessionIdentity;
  verificationRunId: string;
  target: LoopSessionTarget;
  executionTarget: LoopExecutionTarget;
  taskEnvironment: Readonly<Record<string, string>>;
  provider: LoopProviderId;
  model: string;
  checkpointCommit: string;
  signal: AbortSignal;
  deadlineAt?: number;
};

export type NativeBrowserE2EExactSession = NativeBrowserSessionHandle & {
  attemptId: string;
};

export type NativeBrowserE2EAttestationDependencies = {
  resolveTrustedBinding: NativeBrowserVerifierDependencies['resolveTrustedBinding'];
  /**
   * Wave 3 must implement this seam by creating the ACP conversation with both identities supplied
   * by the E2E gate. A provider-generated replacement identity is rejected after the call returns.
   */
  startExactSession(
    input: NativeBrowserE2EExactSessionInput
  ): Promise<Result<NativeBrowserE2EExactSession, NativeBrowserDependencyError>>;
  browser: NativeBrowserVerifierDependencies['browser'];
  evidenceStore: LoopEvidenceStorePort;
  createVerifier(dependencies: NativeBrowserVerifierDependencies): LoopVerifier;
  now(): Date;
  outerSessionDriver?: LoopSessionDriver;
  setActiveConversation?: VerifierRunContext['setActiveConversation'];
};

export type NativeBrowserE2EAttestationPort = {
  run(
    input: NativeBrowserE2EAttestationInput
  ): Promise<Result<NativeBrowserE2EAttestation, NativeBrowserE2EAttestationError>>;
};

type CapturedTerminal = {
  status: LoopEvidenceRunStatus;
  summary: string;
  finishedAt: string;
};

type ExactSessionCapture = {
  startedAt: string | null;
  accepted: boolean;
  authorityInvalid: boolean;
};

export class NativeBrowserE2EAttestationService implements NativeBrowserE2EAttestationPort {
  constructor(private readonly dependencies: NativeBrowserE2EAttestationDependencies) {}

  async run(
    input: NativeBrowserE2EAttestationInput
  ): Promise<Result<NativeBrowserE2EAttestation, NativeBrowserE2EAttestationError>> {
    const validated = validateInput(input);
    if (!validated.success) return validated;

    const exact = validated.data;
    const artifacts: LoopArtifactReference[] = [];
    const session: ExactSessionCapture = {
      startedAt: null,
      accepted: false,
      authorityInvalid: false,
    };
    let terminal: CapturedTerminal | null = null;

    const evidenceStore = wrapEvidenceStore(
      this.dependencies.evidenceStore,
      exact,
      artifacts,
      (value) => {
        terminal = value;
      },
      this.dependencies.now
    );
    const nativeDependencies: NativeBrowserVerifierDependencies = {
      resolveTrustedBinding: async (bindingInput) => {
        const resolved = await this.dependencies.resolveTrustedBinding(bindingInput);
        if (!resolved.success) return resolved;
        if (
          resolved.data.verificationRunId !== exact.verificationRunId ||
          !sameTarget(resolved.data.target, exact.target) ||
          !sameStringRecord(resolved.data.taskEnvironment, exact.taskEnvironment)
        ) {
          return err({
            kind: 'authority-invalid',
            message: 'Native browser binding did not retain the exact clean-room authority.',
          });
        }
        return ok({
          verificationRunId: exact.verificationRunId,
          target: copyTarget(exact.target),
          taskEnvironment: Object.freeze({ ...exact.taskEnvironment }),
          ...(resolved.data.previewServerId
            ? { previewServerId: resolved.data.previewServerId }
            : {}),
        });
      },
      startVerificationSession: async (startInput) => {
        if (
          startInput.verificationRunId !== exact.verificationRunId ||
          !sameTarget(startInput.target, exact.target) ||
          !sameStringRecord(startInput.taskEnvironment, exact.taskEnvironment) ||
          startInput.loop.id !== exact.loop.id ||
          startInput.phase.id !== exact.phase.id
        ) {
          session.authorityInvalid = true;
          return err({
            kind: 'authority-invalid',
            message: 'Native browser session request changed its clean-room authority.',
          });
        }

        session.startedAt = safeNow(this.dependencies.now);
        const started = await this.dependencies.startExactSession({
          loop: exact.loop,
          phase: exact.phase,
          sessionIdentity: { ...exact.sessionIdentity },
          verificationRunId: exact.verificationRunId,
          target: copyTarget(exact.target),
          executionTarget: exact.executionTarget,
          taskEnvironment: Object.freeze({ ...exact.taskEnvironment }),
          provider: exact.provider,
          model: exact.model,
          checkpointCommit: exact.checkpointCommit,
          signal: startInput.signal,
          ...(exact.deadlineAt !== undefined ? { deadlineAt: exact.deadlineAt } : {}),
        });
        if (!started.success) return started;
        if (
          started.data.attemptId !== exact.sessionIdentity.attemptId ||
          started.data.conversationId !== exact.sessionIdentity.conversationId ||
          started.data.verificationRunId !== exact.verificationRunId ||
          !sameTarget(started.data.target, exact.target) ||
          !isAcpSessionDriver(started.data.driver)
        ) {
          await quiesceRejectedSession(started.data);
          session.authorityInvalid = true;
          return err({
            kind: 'authority-invalid',
            message: 'Native browser ACP session did not adopt its preallocated authority.',
          });
        }
        session.accepted = true;
        return ok({
          conversationId: exact.sessionIdentity.conversationId,
          title: safeText(started.data.title, 'Native browser verification', 512),
          verificationRunId: exact.verificationRunId,
          target: copyTarget(exact.target),
          driver: started.data.driver,
        });
      },
      browser: this.dependencies.browser,
      evidenceStore,
    };

    let verifierResult: Awaited<ReturnType<LoopVerifier['run']>>;
    try {
      const verifier = this.dependencies.createVerifier(nativeDependencies);
      verifierResult = await verifier.run({
        loop: exact.loop,
        phase: exact.phase,
        cwd: exact.target.path,
        executionTarget: exact.executionTarget,
        validationCommands: [...exact.loop.config.validationCommands],
        criteria: exact.criteria.map(copyCriterion),
        signal: exact.signal,
        sessionDriver: this.dependencies.outerSessionDriver,
        setActiveConversation: this.dependencies.setActiveConversation,
        ...(exact.deadlineAt !== undefined
          ? { promptTimeoutMs: Math.max(1, exact.deadlineAt - Date.now()) }
          : {}),
      });
    } catch {
      return attestationError(
        'native-browser-execution-error',
        'Native browser attestation could not execute its approved verifier.',
        buildInterruptedAttempt(exact, session, this.dependencies.now)
      );
    }

    if (session.authorityInvalid) {
      return attestationError(
        'session-authority-invalid',
        'Native browser ACP session did not retain its preallocated identity.'
      );
    }

    if (!terminal) {
      return attestationError(
        errorType(verifierResult.success ? null : verifierResult.error),
        verifierResult.success
          ? 'Native browser attestation ended without typed terminal evidence.'
          : safeText(verifierResult.error.message, 'Native browser attestation was rejected.'),
        buildInterruptedAttempt(exact, session, this.dependencies.now)
      );
    }

    const capturedTerminal: CapturedTerminal = terminal;
    if (capturedTerminal.status === 'cancelled') {
      return attestationError(
        verifierResult.success ? 'native-browser-cancelled' : errorType(verifierResult.error),
        'Native browser attestation was cancelled.',
        buildTerminalAttempt(exact, session, 'cancelled', capturedTerminal.finishedAt)
      );
    }
    if (!verifierResult.success && verifierResult.error.kind !== 'command-failed') {
      return attestationError(
        errorType(verifierResult.error),
        safeText(verifierResult.error.message, 'Native browser attestation was rejected.'),
        buildTerminalAttempt(exact, session, 'failed', capturedTerminal.finishedAt)
      );
    }

    const status = productStatus(capturedTerminal.status);
    if (
      (status === 'passed' && !verifierResult.success) ||
      (status !== 'passed' && verifierResult.success) ||
      !session.accepted ||
      session.startedAt === null
    ) {
      return attestationError(
        'native-browser-terminal-invalid',
        'Native browser verifier result did not match its typed terminal evidence.',
        buildInterruptedAttempt(exact, session, this.dependencies.now)
      );
    }

    const summary = safeText(capturedTerminal.summary, defaultSummary(status));
    const sessionAttempt = buildTerminalAttempt(
      exact,
      session,
      'completed',
      capturedTerminal.finishedAt
    );
    if (!sessionAttempt) {
      return attestationError(
        'session-authority-invalid',
        'Native browser ACP session did not produce canonical terminal authority.'
      );
    }
    const evidenceArtifacts = artifacts.slice(0, MAX_ARTIFACTS).map(copyArtifact);
    return ok({
      status,
      summary,
      invocationCount: 1,
      passed: status === 'passed',
      verificationRunId: exact.verificationRunId,
      target: copyTarget(exact.target),
      taskEnvironment: Object.freeze({ ...exact.taskEnvironment }),
      provider: exact.provider,
      model: exact.model,
      checkpointCommit: exact.checkpointCommit,
      sessionAttempt,
      evidence: {
        runId: exact.verificationRunId,
        artifacts: evidenceArtifacts,
      },
      ...(status === 'correctable'
        ? {
            handoff: {
              source: 'Native browser verification',
              handoff: buildLoopPhaseHandoff({
                summary,
                risks: ['The correction requires a fresh clean-room replay.'],
                remainingWork: ['Fix the observed defect and rerun the full E2E checks.'],
                artifacts: evidenceArtifacts,
                createdAt: capturedTerminal.finishedAt,
              }),
            },
          }
        : {}),
      quiescent: true,
    });
  }
}

type ValidatedAttestationInput = Omit<NativeBrowserE2EAttestationInput, 'loop'> & {
  loop: Omit<Loop, 'config'> & { config: NewLoopConfigV2 };
};

function validateInput(
  input: NativeBrowserE2EAttestationInput
): Result<ValidatedAttestationInput, NativeBrowserE2EAttestationError> {
  const target = loopSessionTargetSchema.safeParse(input.target);
  const checkpoint = loopCommitSchema.safeParse(input.checkpointCommit);
  const criteria = input.criteria.map((criterion) => loopPhaseCriterionSchema.safeParse(criterion));
  const config = newLoopConfigV2Schema.strict().safeParse(input.loop.config);
  if (
    !validId(input.loop.id) ||
    !validId(input.phase.id) ||
    input.phase.loopId !== input.loop.id ||
    input.phase.kind !== 'e2e' ||
    !validId(input.verificationRunId) ||
    !validId(input.sessionIdentity.attemptId) ||
    !validId(input.sessionIdentity.conversationId) ||
    !validId(input.outerConversationId) ||
    input.phase.conversationId !== input.outerConversationId ||
    input.sessionIdentity.conversationId === input.outerConversationId ||
    !target.success ||
    !sameTarget(input.executionTarget, target.data) ||
    !sameStringRecord(input.executionTarget.taskEnv, input.taskEnvironment) ||
    input.taskEnvironment.EMDASH_TASK_PATH !== target.data.path ||
    !checkpoint.success ||
    typeof input.model !== 'string' ||
    input.model !== input.model.trim() ||
    input.model.length === 0 ||
    input.model.length > MAX_MODEL_LENGTH ||
    !config.success ||
    config.data.provider !== input.provider ||
    config.data.model !== input.model ||
    input.criteria.length === 0 ||
    input.criteria.length > 64 ||
    criteria.some((criterion) => !criterion.success) ||
    !input.criteria.some((criterion) => criterion.verifier === 'agent-browser') ||
    (input.signal !== undefined && !isAbortSignal(input.signal)) ||
    (input.deadlineAt !== undefined && !Number.isFinite(input.deadlineAt))
  ) {
    return attestationError(
      'native-browser-input-invalid',
      'Native browser attestation requires exact canonical clean-room authority.'
    );
  }
  return ok({
    ...input,
    loop: { ...input.loop, config: config.data },
    target: copyTarget(target.data),
    taskEnvironment: Object.freeze({ ...input.taskEnvironment }),
    criteria: input.criteria.map(copyCriterion),
  });
}

function wrapEvidenceStore(
  store: LoopEvidenceStorePort,
  input: NativeBrowserE2EAttestationInput,
  artifacts: LoopArtifactReference[],
  setTerminal: (terminal: CapturedTerminal) => void,
  now: () => Date
): LoopEvidenceStorePort {
  return {
    async beginRun(beginInput) {
      if (
        beginInput.loopId !== input.loop.id ||
        beginInput.phaseId !== input.phase.id ||
        beginInput.verificationRunId !== input.verificationRunId
      ) {
        throw new TypeError('Native browser evidence authority changed before execution.');
      }
      const run = await store.beginRun(beginInput);
      return wrapEvidenceRun(run, input.verificationRunId, artifacts, setTerminal, now);
    },
  };
}

function wrapEvidenceRun(
  run: LoopEvidenceRunPort,
  verificationRunId: string,
  artifacts: LoopArtifactReference[],
  setTerminal: (terminal: CapturedTerminal) => void,
  now: () => Date
): LoopEvidenceRunPort {
  return {
    directory: run.directory,
    appendObservation: (input) => run.appendObservation(input),
    appendIntermediateFailure: (input) => run.appendIntermediateFailure(input),
    appendLeaseRotation: (input) => run.appendLeaseRotation(input),
    async writeScreenshot(input) {
      const stored = await run.writeScreenshot(input);
      if (artifacts.length < MAX_ARTIFACTS) {
        const artifact = loopArtifactReferenceSchema.safeParse({
          artifactId: stored.artifactId,
          kind: 'screenshot',
          mimeType: stored.mimeType,
          byteLength: stored.byteLength,
          createdAt: safeNow(now),
        });
        if (!artifact.success) {
          throw new TypeError('Native browser evidence returned invalid artifact metadata.');
        }
        artifacts.push(artifact.data);
      }
      return stored;
    },
    async finish(input) {
      await run.finish(input);
      setTerminal({
        status: input.status,
        summary: safeText(input.summary, 'Native browser verification finished.'),
        finishedAt: safeNow(now),
      });
    },
    abandon: () => run.abandon(),
  };
}

function buildTerminalAttempt(
  input: NativeBrowserE2EAttestationInput,
  session: ExactSessionCapture,
  status: 'completed' | 'failed' | 'cancelled' | 'interrupted',
  finishedAt: string
): LoopSessionAttempt | undefined {
  if (!session.accepted || session.startedAt === null) return undefined;
  const parsed = loopSessionAttemptSchema.safeParse({
    attemptId: input.sessionIdentity.attemptId,
    conversationId: input.sessionIdentity.conversationId,
    purpose: 'browser-verification',
    phaseId: input.phase.id,
    verificationRunId: input.verificationRunId,
    target: copyTarget(input.target),
    status,
    checkpointBefore: input.checkpointCommit,
    ...(status === 'completed' ? { checkpointAfter: input.checkpointCommit } : {}),
    startedAt: session.startedAt,
    finishedAt,
  });
  return parsed.success ? parsed.data : undefined;
}

function buildInterruptedAttempt(
  input: NativeBrowserE2EAttestationInput,
  session: ExactSessionCapture,
  now: () => Date
): LoopSessionAttempt | undefined {
  return buildTerminalAttempt(input, session, 'interrupted', safeNow(now));
}

async function quiesceRejectedSession(session: NativeBrowserE2EExactSession): Promise<void> {
  if (!isAcpSessionDriver(session.driver) || typeof session.conversationId !== 'string') return;
  try {
    await session.driver.cancelPrompt(session.conversationId);
  } catch {
    // The strict dependency contract requires rejected identity creation to settle fail-closed.
  }
}

function attestationError(
  type: string,
  message: string,
  attempt?: LoopSessionAttempt
): Result<never, NativeBrowserE2EAttestationError> {
  return err({
    type,
    message: safeText(message, 'Native browser attestation was rejected.'),
    quiescent: true,
    ...(attempt ? { sessionAttempts: [attempt] } : {}),
  });
}

function errorType(error: VerifierError | null): string {
  switch (error?.kind) {
    case 'aborted':
      return 'native-browser-cancelled';
    case 'timed-out':
      return 'native-browser-timed-out';
    case 'invalid-config':
      return 'native-browser-input-invalid';
    case 'unavailable':
      return 'native-browser-unavailable';
    case 'execution-error':
      return 'native-browser-execution-error';
    default:
      return 'native-browser-rejected';
  }
}

function productStatus(
  status: Exclude<LoopEvidenceRunStatus, 'cancelled'>
): NativeBrowserE2EAttestationStatus {
  return status === 'correction-required' ? 'correctable' : status;
}

function defaultSummary(status: NativeBrowserE2EAttestationStatus): string {
  if (status === 'passed') return 'Native browser verification passed.';
  if (status === 'correctable') return 'Native browser verification requires a correction.';
  return 'Native browser verification failed.';
}

function copyArtifact(artifact: LoopArtifactReference): LoopArtifactReference {
  return loopArtifactReferenceSchema.parse({ ...artifact });
}

function copyCriterion(criterion: LoopPhaseCriterion): LoopPhaseCriterion {
  return loopPhaseCriterionSchema.parse(criterion);
}

function copyTarget(target: LoopSessionTarget): LoopSessionTarget {
  return loopSessionTargetSchema.parse(target);
}

function sameTarget(left: unknown, right: unknown): boolean {
  const leftTarget = parseTargetLike(left);
  const rightTarget = parseTargetLike(right);
  return (
    leftTarget.success &&
    rightTarget.success &&
    JSON.stringify(leftTarget.data) === JSON.stringify(rightTarget.data)
  );
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
        rightEntries[index]?.[0] === key && rightEntries[index]?.[1] === value
    )
  );
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== 'undefined' && value instanceof AbortSignal;
}

function isAcpSessionDriver(value: unknown): value is LoopSessionDriver {
  if (!value || typeof value !== 'object') return false;
  const driver = value as Partial<LoopSessionDriver>;
  return (
    driver.kind === 'acp' &&
    typeof driver.startPhaseSession === 'function' &&
    typeof driver.startVerificationSession === 'function' &&
    typeof driver.sendPrompt === 'function' &&
    typeof driver.cancelPrompt === 'function'
  );
}

function safeNow(now: () => Date): string {
  try {
    const value = now();
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  } catch {
    // Fall through to a canonical timestamp for diagnostic-only attempt metadata.
  }
  return new Date().toISOString();
}

function safeText(value: unknown, fallback: string, limit = MAX_SUMMARY_LENGTH): string {
  const candidate = typeof value === 'string' ? value : fallback;
  const withoutPaths = candidate
    .replace(windowsAbsolutePathPattern, '[REDACTED_PATH]')
    .replace(posixAbsolutePathPattern, (_match, prefix: string) => `${prefix}[REDACTED_PATH]`);
  const redacted = redactAll(
    withoutPaths.replace(cookieAssignmentPattern, '[REDACTED_COOKIE]')
  ).trim();
  return (redacted || redactAll(fallback)).slice(0, limit);
}
