import { Buffer } from 'node:buffer';
import { posix, win32 } from 'node:path';
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
import { e2eCriteriaSchema } from '../gates/clean-room-e2e-input';
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
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_NATIVE_SESSION_ATTEMPTS = 64;
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
  quiescent: boolean;
  recoveryRequired: boolean;
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
  purpose: 'browser-verification';
  phaseId: string;
  taskEnvironment: Readonly<Record<string, string>>;
  provider: LoopProviderId;
  model: string;
  checkpointCommit: string;
};

export type NativeBrowserE2EExactSessionError = NativeBrowserDependencyError & {
  /** True only when the implementation proves that the failed start created no live session. */
  quiescent: boolean;
  recoveryRequired?: boolean;
  sessionAttempts?: readonly LoopSessionAttempt[];
};

export type NativeBrowserE2EAttestationDependencies = {
  resolveTrustedBinding: NativeBrowserVerifierDependencies['resolveTrustedBinding'];
  /**
   * Wave 3 must implement this seam by creating the ACP conversation with both identities supplied
   * by the E2E gate. A provider-generated replacement identity is rejected after the call returns.
   */
  startExactSession(
    input: NativeBrowserE2EExactSessionInput
  ): Promise<Result<NativeBrowserE2EExactSession, NativeBrowserE2EExactSessionError>>;
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
  startInvocations: number;
  startFailure: NativeBrowserE2EExactSessionError | null;
  startFailureAuthorityComplete: boolean;
  knownSessions: KnownSession[];
  recoveryDriver?: LoopSessionDriver;
};

type KnownSession = {
  session: NativeBrowserE2EExactSession;
  settlement: Promise<SessionSettlement> | null;
};

type CapturedExactSession = {
  session: NativeBrowserE2EExactSession;
  exactEcho: boolean;
};

type SessionSettlement = {
  quiescent: boolean;
  attempts: LoopSessionAttempt[];
};

type CapturedEvidenceRun = {
  run: LoopEvidenceRunPort;
  settled: boolean;
};

export class NativeBrowserE2EAttestationService implements NativeBrowserE2EAttestationPort {
  constructor(private readonly dependencies: NativeBrowserE2EAttestationDependencies) {}

  async run(
    input: NativeBrowserE2EAttestationInput
  ): Promise<Result<NativeBrowserE2EAttestation, NativeBrowserE2EAttestationError>> {
    const snapshot = snapshotAttestationInput(input);
    if (!snapshot) {
      return attestationError(
        'native-browser-input-invalid',
        'Native browser attestation requires stable canonical clean-room authority.'
      );
    }
    const validated = validateInput(snapshot);
    if (!validated.success) return validated;

    const exact = validated.data;
    const artifacts: LoopArtifactReference[] = [];
    const evidenceRuns: CapturedEvidenceRun[] = [];
    const session: ExactSessionCapture = {
      startedAt: null,
      accepted: false,
      authorityInvalid: false,
      startInvocations: 0,
      startFailure: null,
      startFailureAuthorityComplete: true,
      knownSessions: [],
      ...(this.dependencies.outerSessionDriver
        ? { recoveryDriver: this.dependencies.outerSessionDriver }
        : {}),
    };
    let terminal: CapturedTerminal | null = null;

    const evidenceStore = wrapEvidenceStore(
      this.dependencies.evidenceStore,
      exact,
      artifacts,
      (value) => {
        terminal = value;
      },
      this.dependencies.now,
      evidenceRuns
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
        session.startInvocations += 1;
        if (
          session.startInvocations !== 1 ||
          startInput.verificationRunId !== exact.verificationRunId ||
          !sameTarget(startInput.target, exact.target) ||
          !sameStringRecord(startInput.taskEnvironment, exact.taskEnvironment) ||
          startInput.loop.id !== exact.loop.id ||
          startInput.phase.id !== exact.phase.id ||
          controlStopped(exact)
        ) {
          session.authorityInvalid = true;
          return err({
            kind: 'authority-invalid',
            message: 'Native browser session request changed its clean-room authority.',
          });
        }

        session.startedAt = safeNow(this.dependencies.now);
        let started: Result<NativeBrowserE2EExactSession, NativeBrowserE2EExactSessionError>;
        try {
          started = await this.dependencies.startExactSession({
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
        } catch {
          session.authorityInvalid = true;
          session.startFailureAuthorityComplete = false;
          session.startFailure = {
            kind: 'execution-error',
            message: 'Exact native browser session start threw after receiving its authority.',
            quiescent: false,
            recoveryRequired: true,
          };
          return err({
            kind: 'execution-error',
            message: session.startFailure.message,
          });
        }
        let startSucceeded: boolean;
        try {
          startSucceeded = started.success === true;
        } catch {
          session.startFailure = unreadableStartFailure();
          session.startFailureAuthorityComplete = false;
          session.authorityInvalid = true;
          return err({ kind: 'execution-error', message: session.startFailure.message });
        }
        if (!startSucceeded) {
          let rawFailure: unknown;
          try {
            rawFailure = (started as { success: false; error: unknown }).error;
          } catch {
            rawFailure = undefined;
          }
          const stabilized = stabilizeStartFailure(
            rawFailure,
            exact,
            session.startedAt ?? safeNow(this.dependencies.now)
          );
          session.startFailure = stabilized.failure;
          session.startFailureAuthorityComplete = stabilized.complete;
          if (!stabilized.failure.quiescent) session.authorityInvalid = true;
          return err({ kind: stabilized.failure.kind, message: stabilized.failure.message });
        }
        let rawSession: unknown;
        try {
          rawSession = (started as { success: true; data: unknown }).data;
        } catch {
          rawSession = undefined;
        }
        const capturedSession = snapshotExactSession(rawSession, exact);
        if (!capturedSession) {
          session.authorityInvalid = true;
          session.startFailureAuthorityComplete = false;
          session.startFailure = unreadableStartFailure();
          return err({ kind: 'execution-error', message: session.startFailure.message });
        }
        const returnedSession = capturedSession.session;
        const knownSession: KnownSession = { session: returnedSession, settlement: null };
        session.knownSessions.push(knownSession);
        if (!capturedSession.exactEcho || !isAcpSessionDriver(returnedSession.driver)) {
          knownSession.settlement = settleKnownSession(
            returnedSession,
            exact,
            session.startedAt,
            this.dependencies.now
          );
          const settlement = await knownSession.settlement;
          session.authorityInvalid = true;
          session.startFailure = {
            kind: 'authority-invalid',
            message: settlement.quiescent
              ? 'Native browser ACP session did not adopt its preallocated authority.'
              : 'Native browser ACP session identity drifted and cancellation was not acknowledged.',
            quiescent: settlement.quiescent,
            recoveryRequired: !settlement.quiescent,
            sessionAttempts: settlement.attempts,
          };
          return err({
            kind: 'authority-invalid',
            message: session.startFailure.message,
          });
        }
        session.accepted = true;
        return ok({
          conversationId: exact.sessionIdentity.conversationId,
          title: safeText(returnedSession.title, 'Native browser verification', 512),
          verificationRunId: exact.verificationRunId,
          target: copyTarget(exact.target),
          driver: returnedSession.driver,
        });
      },
      browser: this.dependencies.browser,
      evidenceStore,
    };

    let verifierResult: Awaited<ReturnType<LoopVerifier['run']>>;
    try {
      if (controlStopped(exact)) {
        return attestationError(controlErrorType(exact), controlErrorMessage(exact), {
          quiescent: true,
        });
      }
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
      const recovered = await settleCapturedResources(
        exact,
        session,
        evidenceRuns,
        this.dependencies.now,
        true
      );
      return attestationError(
        'native-browser-execution-error',
        'Native browser attestation could not execute its approved verifier.',
        recovered
      );
    }

    if (session.authorityInvalid) {
      const recovered = await settleCapturedResources(
        exact,
        session,
        evidenceRuns,
        this.dependencies.now,
        true
      );
      return attestationError(
        'session-authority-invalid',
        session.startFailure?.message ??
          'Native browser ACP session did not retain its preallocated identity.',
        recovered
      );
    }

    if (!terminal) {
      const recovered = await settleCapturedResources(
        exact,
        session,
        evidenceRuns,
        this.dependencies.now,
        true
      );
      return attestationError(
        errorType(verifierResult.success ? null : verifierResult.error),
        verifierResult.success
          ? 'Native browser attestation ended without typed terminal evidence.'
          : safeText(verifierResult.error.message, 'Native browser attestation was rejected.'),
        recovered
      );
    }

    const capturedTerminal: CapturedTerminal = terminal;
    if (capturedTerminal.status === 'cancelled') {
      const recovered = await settleCapturedResources(
        exact,
        session,
        evidenceRuns,
        this.dependencies.now,
        true
      );
      return attestationError(
        verifierResult.success ? 'native-browser-cancelled' : errorType(verifierResult.error),
        verifierResult.success
          ? 'Native browser attestation was cancelled.'
          : safeText(verifierResult.error.message, 'Native browser attestation was cancelled.'),
        recovered
      );
    }
    if (!verifierResult.success && verifierResult.error.kind !== 'command-failed') {
      const recovered = await settleCapturedResources(
        exact,
        session,
        evidenceRuns,
        this.dependencies.now,
        true
      );
      return attestationError(
        errorType(verifierResult.error),
        safeText(verifierResult.error.message, 'Native browser attestation was rejected.'),
        recovered
      );
    }

    const status = productStatus(capturedTerminal.status);
    if (
      (status === 'passed' && !verifierResult.success) ||
      (status !== 'passed' && verifierResult.success) ||
      !session.accepted ||
      session.startedAt === null ||
      session.startInvocations !== 1
    ) {
      const recovered = await settleCapturedResources(
        exact,
        session,
        evidenceRuns,
        this.dependencies.now,
        true
      );
      return attestationError(
        'native-browser-terminal-invalid',
        'Native browser verifier result did not match its typed terminal evidence.',
        recovered
      );
    }

    const summary = safeText(capturedTerminal.summary, defaultSummary(status));
    const settled = await settleCapturedResources(
      exact,
      session,
      evidenceRuns,
      this.dependencies.now,
      true
    );
    const exactSessionSettled = settled.sessionAttempts?.some(
      (candidate) =>
        candidate.attemptId === exact.sessionIdentity.attemptId &&
        candidate.conversationId === exact.sessionIdentity.conversationId &&
        candidate.status === 'cancelled'
    );
    if (!settled.quiescent || !exactSessionSettled) {
      return attestationError(
        'native-browser-quiescence-failed',
        'Native browser ACP session did not prove exact terminal settlement.',
        settled
      );
    }
    const sessionAttempt = buildTerminalAttempt(
      exact,
      session,
      'completed',
      capturedTerminal.finishedAt
    );
    if (!sessionAttempt) {
      const recovered = await settleCapturedResources(
        exact,
        session,
        evidenceRuns,
        this.dependencies.now,
        true
      );
      return attestationError(
        'session-authority-invalid',
        'Native browser ACP session did not produce canonical terminal authority.',
        recovered
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

function snapshotAttestationInput(
  input: NativeBrowserE2EAttestationInput
): NativeBrowserE2EAttestationInput | undefined {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
    const loop = input.loop;
    const phase = input.phase;
    const verificationRunId = input.verificationRunId;
    const sessionIdentity = input.sessionIdentity;
    const outerConversationId = input.outerConversationId;
    const target = input.target;
    const executionTarget = input.executionTarget;
    const taskEnvironment = input.taskEnvironment;
    const provider = input.provider;
    const model = input.model;
    const checkpointCommit = input.checkpointCommit;
    const criteria = input.criteria;
    const signal = input.signal;
    const deadlineAt = input.deadlineAt;
    if (!executionTarget || typeof executionTarget !== 'object') return undefined;
    const workspaceId = executionTarget.workspaceId;
    const executionPath = executionTarget.path;
    const machine = executionTarget.machine;
    const taskEnv = executionTarget.taskEnv;
    const executionContext = executionTarget.executionContext;
    const dispose = executionTarget.dispose;
    if (
      !executionContext ||
      typeof executionContext !== 'object' ||
      typeof dispose !== 'function'
    ) {
      return undefined;
    }
    const stable = stabilizeJson(
      {
        loop,
        phase,
        verificationRunId,
        sessionIdentity,
        outerConversationId,
        target,
        executionTarget: {
          workspaceId,
          path: executionPath,
          machine,
          taskEnv,
        },
        taskEnvironment,
        provider,
        model,
        checkpointCommit,
        criteria,
        ...(deadlineAt !== undefined ? { deadlineAt } : {}),
      },
      MAX_INPUT_BYTES
    );
    if (!stable || typeof stable !== 'object' || Array.isArray(stable)) return undefined;
    const captured = stable as Omit<
      NativeBrowserE2EAttestationInput,
      'executionTarget' | 'signal'
    > & {
      executionTarget: Pick<LoopExecutionTarget, 'workspaceId' | 'path' | 'machine' | 'taskEnv'>;
    };
    return {
      ...captured,
      executionTarget: {
        ...captured.executionTarget,
        executionContext,
        dispose: () => dispose.call(executionTarget),
      },
      ...(signal !== undefined ? { signal } : {}),
    };
  } catch {
    return undefined;
  }
}

function validateInput(
  input: NativeBrowserE2EAttestationInput
): Result<ValidatedAttestationInput, NativeBrowserE2EAttestationError> {
  try {
    const target = loopSessionTargetSchema.safeParse(input.target);
    const checkpoint = loopCommitSchema.safeParse(input.checkpointCommit);
    const criteria = e2eCriteriaSchema.safeParse(input.criteria);
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
      !sameExactTarget(input.target, target.data) ||
      !isCanonicalAbsolutePath(target.data.path) ||
      !sameExactTarget(
        {
          workspaceId: input.executionTarget.workspaceId,
          path: input.executionTarget.path,
          machine: input.executionTarget.machine,
        },
        target.data
      ) ||
      !sameStringRecord(input.executionTarget.taskEnv, input.taskEnvironment) ||
      input.taskEnvironment.EMDASH_TASK_PATH !== target.data.path ||
      !isCanonicalAbsolutePath(input.taskEnvironment.EMDASH_ROOT_PATH) ||
      !checkpoint.success ||
      typeof input.model !== 'string' ||
      input.model !== input.model.trim() ||
      input.model.length === 0 ||
      input.model.length > MAX_MODEL_LENGTH ||
      !config.success ||
      config.data.provider !== input.provider ||
      config.data.model !== input.model ||
      !criteria.success ||
      !canonicalDeepEqual(input.criteria, criteria.data) ||
      (input.signal !== undefined && !isAbortSignal(input.signal)) ||
      (input.deadlineAt !== undefined &&
        (!Number.isFinite(input.deadlineAt) || Date.now() >= input.deadlineAt)) ||
      (input.signal !== undefined && signalAborted(input.signal))
    ) {
      throw new TypeError();
    }
    return ok({
      ...input,
      loop: { ...input.loop, config: config.data },
      target: copyTarget(target.data),
      taskEnvironment: Object.freeze({ ...input.taskEnvironment }),
      criteria: criteria.data.map(copyCriterion),
    });
  } catch {
    return attestationError(
      'native-browser-input-invalid',
      'Native browser attestation requires exact canonical clean-room authority.'
    );
  }
}

function wrapEvidenceStore(
  store: LoopEvidenceStorePort,
  input: NativeBrowserE2EAttestationInput,
  artifacts: LoopArtifactReference[],
  setTerminal: (terminal: CapturedTerminal) => void,
  now: () => Date,
  capturedRuns: CapturedEvidenceRun[]
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
      const captured: CapturedEvidenceRun = { run, settled: false };
      capturedRuns.push(captured);
      return wrapEvidenceRun(run, artifacts, setTerminal, now, captured);
    },
  };
}

function wrapEvidenceRun(
  run: LoopEvidenceRunPort,
  artifacts: LoopArtifactReference[],
  setTerminal: (terminal: CapturedTerminal) => void,
  now: () => Date,
  captured: CapturedEvidenceRun
): LoopEvidenceRunPort {
  return {
    directory: run.directory,
    appendObservation: (input) => run.appendObservation(input),
    appendIntermediateFailure: (input) => run.appendIntermediateFailure(input),
    appendLeaseRotation: (input) => run.appendLeaseRotation(input),
    async writeScreenshot(input) {
      const stored = await run.writeScreenshot(input);
      if (artifacts.length < MAX_ARTIFACTS) {
        const mimeType = safeScreenshotMimeType(stored.mimeType);
        if (!mimeType) {
          throw new TypeError('Native browser evidence returned invalid artifact metadata.');
        }
        const artifact = loopArtifactReferenceSchema.safeParse({
          artifactId: stored.artifactId,
          kind: 'screenshot',
          mimeType,
          byteLength: stored.byteLength,
          createdAt: safeNow(now),
        });
        if (
          !artifact.success ||
          /[\\/]/u.test(artifact.data.artifactId) ||
          safeText(artifact.data.artifactId, 'opaque-artifact', 256) !== artifact.data.artifactId
        ) {
          throw new TypeError('Native browser evidence returned invalid artifact metadata.');
        }
        artifacts.push(artifact.data);
      }
      return stored;
    },
    async finish(input) {
      await run.finish(input);
      captured.settled = true;
      setTerminal({
        status: input.status,
        summary: safeText(input.summary, 'Native browser verification finished.'),
        finishedAt: safeNow(now),
      });
    },
    async abandon() {
      await run.abandon();
      captured.settled = true;
    },
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
    finishedAt: monotonicTimestamp(session.startedAt, finishedAt),
  });
  return parsed.success ? parsed.data : undefined;
}

async function settleCapturedResources(
  input: NativeBrowserE2EAttestationInput,
  session: ExactSessionCapture,
  evidenceRuns: CapturedEvidenceRun[],
  now: () => Date,
  cancelSessions: boolean
): Promise<AttestationErrorOptions> {
  const attempts: LoopSessionAttempt[] = [];
  const recoveredStart = await settleStartFailureSessions(input, session, now);
  let quiescent = recoveredStart.quiescent;
  attempts.push(...recoveredStart.attempts);
  for (const known of session.knownSessions) {
    if (cancelSessions && known.settlement === null) {
      known.settlement = settleKnownSession(known.session, input, session.startedAt, now);
    }
  }
  const knownSettlements = await Promise.all(
    session.knownSessions.flatMap((known) => (known.settlement ? [known.settlement] : []))
  );
  for (const settlement of knownSettlements) {
    quiescent &&= settlement.quiescent;
    attempts.push(...settlement.attempts);
  }
  for (const captured of evidenceRuns) {
    if (captured.settled) continue;
    let settled = false;
    try {
      await captured.run.finish({
        status: 'failed',
        summary: 'Native browser verifier stopped before terminal evidence.',
      });
      captured.settled = true;
      settled = true;
    } catch {
      try {
        await captured.run.abandon();
        captured.settled = true;
        settled = true;
      } catch {
        settled = false;
      }
    }
    quiescent &&= settled;
  }
  if (session.startedAt !== null && attempts.length === 0) {
    const interrupted = buildIdentityAttempt(
      input,
      input.sessionIdentity,
      'interrupted',
      session.startedAt,
      safeNow(now),
      'Native browser session start did not produce terminal authority.'
    );
    if (interrupted) attempts.push(interrupted);
  }
  return {
    quiescent,
    sessionAttempts: deduplicateAttempts(attempts),
  };
}

async function settleStartFailureSessions(
  input: NativeBrowserE2EAttestationInput,
  session: ExactSessionCapture,
  now: () => Date
): Promise<SessionSettlement> {
  const failure = session.startFailure;
  if (!failure) return { quiescent: true, attempts: [] };
  const reported = (failure.sessionAttempts ?? []).flatMap((candidate) => {
    const copied = copyCanonicalAttempt(candidate);
    return copied && attemptMatchesExactAuthority(copied, input) ? [copied] : [];
  });
  const terminal = reported.filter(isTerminalAttempt);
  const unsettled = reported.filter((attempt) => !isTerminalAttempt(attempt));
  if (failure.quiescent) {
    return {
      quiescent: session.startFailureAuthorityComplete && unsettled.length === 0,
      attempts: terminal,
    };
  }

  const startedAt = session.startedAt ?? safeNow(now);
  const identities = distinctNativeRecoveryIdentities([
    { ...input.sessionIdentity, startedAt },
    ...unsettled.map((attempt) => ({
      attemptId: attempt.attemptId,
      conversationId: attempt.conversationId,
      startedAt: attempt.startedAt,
    })),
  ]);
  const cancellations = identities.map((identity) => ({
    identity,
    result: cancelNativeConversation(session.recoveryDriver, identity.conversationId),
  }));
  const settled = await Promise.all(
    cancellations.map(async ({ identity, result }) => ({ identity, acknowledged: await result }))
  );
  const finishedAt = safeNow(now);
  const recoveredAttempts = settled.flatMap(({ identity, acknowledged }) => {
    const attempt = buildIdentityAttempt(
      input,
      identity,
      acknowledged ? 'cancelled' : 'interrupted',
      identity.startedAt,
      finishedAt,
      acknowledged ? undefined : 'Native browser session recovery was not acknowledged.'
    );
    return attempt ? [attempt] : [];
  });
  return {
    quiescent:
      session.startFailureAuthorityComplete &&
      settled.length === identities.length &&
      settled.every(({ acknowledged }) => acknowledged),
    attempts: [...terminal, ...recoveredAttempts],
  };
}

async function cancelNativeConversation(
  driver: LoopSessionDriver | undefined,
  conversationId: string
): Promise<boolean> {
  if (!driver || !isAcpSessionDriver(driver)) return false;
  try {
    const result = await driver.cancelPrompt(conversationId);
    return result?.success === true;
  } catch {
    return false;
  }
}

function distinctNativeRecoveryIdentities(
  identities: readonly (NativeBrowserE2ESessionIdentity & { startedAt: string })[]
): Array<NativeBrowserE2ESessionIdentity & { startedAt: string }> {
  const seen = new Set<string>();
  return identities.filter((identity) => {
    const key = `${identity.attemptId}\u0000${identity.conversationId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function settleKnownSession(
  session: NativeBrowserE2EExactSession,
  input: NativeBrowserE2EAttestationInput,
  startedAt: string | null,
  now: () => Date
): Promise<SessionSettlement> {
  const finishedAt = safeNow(now);
  const actualIdentity = readSessionIdentity(session);
  const expectedIdentity = input.sessionIdentity;
  const identities = [expectedIdentity];
  if (
    actualIdentity &&
    (actualIdentity.attemptId !== expectedIdentity.attemptId ||
      actualIdentity.conversationId !== expectedIdentity.conversationId)
  ) {
    identities.push(actualIdentity);
  }
  if (!isAcpSessionDriver(session.driver) || !actualIdentity || startedAt === null) {
    return {
      quiescent: false,
      attempts: identities.flatMap((identity) => {
        const attempt = buildIdentityAttempt(
          input,
          identity,
          'interrupted',
          startedAt ?? finishedAt,
          finishedAt,
          'Native browser session cancellation authority was unreadable.'
        );
        return attempt ? [attempt] : [];
      }),
    };
  }
  const cancellationByConversation = new Map<string, boolean>();
  await Promise.all(
    [...new Set(identities.map((identity) => identity.conversationId))].map(
      async (conversationId) => {
        let acknowledged = false;
        try {
          const cancelled = await session.driver.cancelPrompt(conversationId);
          acknowledged = cancelled?.success === true;
        } catch {
          acknowledged = false;
        }
        cancellationByConversation.set(conversationId, acknowledged);
      }
    )
  );
  const attempts = identities.flatMap((identity) => {
    const acknowledged = cancellationByConversation.get(identity.conversationId) === true;
    const attempt = buildIdentityAttempt(
      input,
      identity,
      acknowledged ? 'cancelled' : 'interrupted',
      startedAt,
      finishedAt,
      acknowledged ? undefined : 'Native browser session cancellation was not acknowledged.'
    );
    return attempt ? [attempt] : [];
  });
  return {
    quiescent:
      attempts.length === identities.length &&
      [...cancellationByConversation.values()].every(Boolean),
    attempts,
  };
}

function buildIdentityAttempt(
  input: NativeBrowserE2EAttestationInput,
  identity: NativeBrowserE2ESessionIdentity,
  status: 'cancelled' | 'interrupted',
  startedAt: string,
  finishedAt: string,
  error?: string
): LoopSessionAttempt | undefined {
  const parsed = loopSessionAttemptSchema.safeParse({
    attemptId: identity.attemptId,
    conversationId: identity.conversationId,
    purpose: 'browser-verification',
    phaseId: input.phase.id,
    verificationRunId: input.verificationRunId,
    target: copyTarget(input.target),
    status,
    checkpointBefore: input.checkpointCommit,
    startedAt,
    finishedAt: monotonicTimestamp(startedAt, finishedAt),
    ...(error ? { error: safeText(error, 'Native browser session cleanup failed.', 4_096) } : {}),
  });
  return parsed.success ? parsed.data : undefined;
}

function readSessionIdentity(
  session: NativeBrowserE2EExactSession
): NativeBrowserE2ESessionIdentity | undefined {
  try {
    if (!validId(session.attemptId) || !validId(session.conversationId)) return undefined;
    return { attemptId: session.attemptId, conversationId: session.conversationId };
  } catch {
    return undefined;
  }
}

type AttestationErrorOptions = {
  quiescent: boolean;
  sessionAttempts?: readonly LoopSessionAttempt[];
};

function attestationError(
  type: string,
  message: string,
  options: AttestationErrorOptions = { quiescent: true }
): Result<never, NativeBrowserE2EAttestationError> {
  const attempts = deduplicateAttempts(
    (options.sessionAttempts ?? []).flatMap((attempt) => {
      const copied = copyCanonicalAttempt(attempt);
      return copied ? [copied] : [];
    })
  );
  return err({
    type: validErrorType(type) ? type : 'native-browser-rejected',
    message: safeText(message, 'Native browser attestation was rejected.'),
    quiescent: options.quiescent,
    recoveryRequired: !options.quiescent,
    ...(attempts.length > 0 ? { sessionAttempts: attempts } : {}),
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

function snapshotExactSession(
  value: unknown,
  input: NativeBrowserE2EAttestationInput
): CapturedExactSession | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const attemptId = readProperty(value, 'attemptId');
    const conversationId = readProperty(value, 'conversationId');
    if (!validId(attemptId) || !validId(conversationId)) return undefined;
    let exactKeys = false;
    try {
      exactKeys = hasExactKeys(value, [
        'attemptId',
        'checkpointCommit',
        'conversationId',
        'driver',
        'model',
        'phaseId',
        'provider',
        'purpose',
        'target',
        'taskEnvironment',
        'title',
        'verificationRunId',
      ]);
    } catch {
      exactKeys = false;
    }
    const title = readProperty(value, 'title');
    const purpose = readProperty(value, 'purpose');
    const phaseId = readProperty(value, 'phaseId');
    const verificationRunId = readProperty(value, 'verificationRunId');
    const rawTarget = readProperty(value, 'target');
    const rawTaskEnvironment = readProperty(value, 'taskEnvironment');
    const provider = readProperty(value, 'provider');
    const model = readProperty(value, 'model');
    const checkpointCommit = readProperty(value, 'checkpointCommit');
    const driver = readProperty(value, 'driver');
    const stableAuthority = stabilizeJson(
      { target: rawTarget, taskEnvironment: rawTaskEnvironment },
      512 * 1024
    ) as { target?: unknown; taskEnvironment?: unknown } | undefined;
    const rawStableTarget = stableAuthority?.target;
    const rawStableEnvironment = stableAuthority?.taskEnvironment;
    const target = loopSessionTargetSchema.safeParse(rawStableTarget);
    const taskEnvironment =
      rawStableEnvironment &&
      typeof rawStableEnvironment === 'object' &&
      !Array.isArray(rawStableEnvironment)
        ? (rawStableEnvironment as Record<string, string>)
        : undefined;
    const exactEcho =
      exactKeys &&
      attemptId === input.sessionIdentity.attemptId &&
      conversationId === input.sessionIdentity.conversationId &&
      purpose === 'browser-verification' &&
      phaseId === input.phase.id &&
      verificationRunId === input.verificationRunId &&
      sameExactTarget(rawStableTarget, input.target) &&
      sameExactStringRecord(taskEnvironment, input.taskEnvironment) &&
      provider === input.provider &&
      model === input.model &&
      checkpointCommit === input.checkpointCommit &&
      typeof title === 'string';
    return {
      exactEcho,
      session: {
        attemptId,
        conversationId,
        title: typeof title === 'string' ? title : 'Native browser verification',
        purpose: 'browser-verification',
        phaseId: validId(phaseId) ? phaseId : input.phase.id,
        verificationRunId: validId(verificationRunId) ? verificationRunId : input.verificationRunId,
        target: copyTarget(target.success ? target.data : input.target),
        taskEnvironment: Object.freeze(taskEnvironment ?? { ...input.taskEnvironment }),
        provider:
          provider === 'claude' ? 'claude' : provider === 'codex' ? 'codex' : input.provider,
        model: typeof model === 'string' ? model : input.model,
        checkpointCommit:
          typeof checkpointCommit === 'string' ? checkpointCommit : input.checkpointCommit,
        driver: driver as LoopSessionDriver,
      },
    };
  } catch {
    return undefined;
  }
}

function readProperty(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function unreadableStartFailure(): NativeBrowserE2EExactSessionError {
  return {
    kind: 'execution-error',
    message: 'Exact native browser session start returned unreadable success authority.',
    quiescent: false,
    recoveryRequired: true,
  };
}

function stabilizeStartFailure(
  value: unknown,
  input: NativeBrowserE2EAttestationInput,
  fallbackStartedAt: string
): { failure: NativeBrowserE2EExactSessionError; complete: boolean } {
  try {
    const stable = stabilizeJson(value, 512 * 1024);
    if (!stable || typeof stable !== 'object' || Array.isArray(stable)) throw new TypeError();
    const candidate = stable as Record<string, unknown>;
    const rawAttempts = candidate.sessionAttempts;
    let allAttemptsCanonical = true;
    const attempts = Array.isArray(rawAttempts)
      ? rawAttempts.slice(0, MAX_NATIVE_SESSION_ATTEMPTS - 1).flatMap((attempt) => {
          const copied = copyCanonicalAttempt(attempt);
          if (copied && attemptMatchesExactAuthority(copied, input)) return [copied];
          allAttemptsCanonical = false;
          const salvaged = salvageNativeStartAttempt(attempt, input, fallbackStartedAt);
          return salvaged ? [salvaged] : [];
        })
      : [];
    const complete =
      rawAttempts === undefined ||
      (Array.isArray(rawAttempts) &&
        rawAttempts.length < MAX_NATIVE_SESSION_ATTEMPTS &&
        attempts.length === rawAttempts.length &&
        allAttemptsCanonical);
    const allReportedTerminal = attempts.every(isTerminalAttempt);
    const quiescent =
      complete &&
      allReportedTerminal &&
      candidate.quiescent === true &&
      candidate.recoveryRequired !== true;
    return {
      complete,
      failure: {
        kind: validErrorType(candidate.kind) ? candidate.kind : 'execution-error',
        message: safeText(
          candidate.message,
          quiescent
            ? 'Exact native browser session start failed atomically.'
            : 'Exact native browser session start did not prove failure atomicity.'
        ),
        quiescent,
        recoveryRequired: !quiescent,
        ...(attempts.length > 0 ? { sessionAttempts: attempts } : {}),
      },
    };
  } catch {
    return {
      complete: false,
      failure: {
        kind: 'execution-error',
        message: 'Exact native browser session start returned unreadable failure authority.',
        quiescent: false,
        recoveryRequired: true,
      },
    };
  }
}

function salvageNativeStartAttempt(
  value: unknown,
  input: NativeBrowserE2EAttestationInput,
  fallbackStartedAt: string
): LoopSessionAttempt | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const candidate = value as Record<string, unknown>;
    const attemptId = candidate.attemptId;
    const conversationId = candidate.conversationId;
    if (
      !validId(attemptId) ||
      !validId(conversationId) ||
      conversationId === input.outerConversationId
    ) {
      return undefined;
    }
    const startedAt = validTimestamp(candidate.startedAt) ? candidate.startedAt : fallbackStartedAt;
    const parsed = loopSessionAttemptSchema.safeParse({
      attemptId,
      conversationId,
      purpose: 'browser-verification',
      phaseId: input.phase.id,
      verificationRunId: input.verificationRunId,
      target: copyTarget(input.target),
      status: 'starting',
      checkpointBefore: input.checkpointCommit,
      startedAt,
    });
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function copyCanonicalAttempt(value: unknown): LoopSessionAttempt | undefined {
  try {
    const parsed = loopSessionAttemptSchema.safeParse(value);
    if (
      !parsed.success ||
      !canonicalDeepEqual(value, parsed.data) ||
      !validTimestamp(parsed.data.startedAt) ||
      (parsed.data.finishedAt !== undefined &&
        (!validTimestamp(parsed.data.finishedAt) ||
          Date.parse(parsed.data.finishedAt) < Date.parse(parsed.data.startedAt))) ||
      (parsed.data.error !== undefined &&
        safeText(parsed.data.error, 'Native browser session failed.', 4_096) !== parsed.data.error)
    ) {
      return undefined;
    }
    return parsed.data;
  } catch {
    return undefined;
  }
}

function deduplicateAttempts(attempts: readonly LoopSessionAttempt[]): LoopSessionAttempt[] {
  const seen = new Set<string>();
  const result: LoopSessionAttempt[] = [];
  for (const attempt of attempts) {
    const copied = copyCanonicalAttempt(attempt);
    if (!copied) continue;
    const key = `${copied.attemptId}\u0000${copied.conversationId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(copied);
    if (result.length >= MAX_NATIVE_SESSION_ATTEMPTS) break;
  }
  return result;
}

function isTerminalAttempt(attempt: LoopSessionAttempt): boolean {
  return (
    ['completed', 'failed', 'cancelled', 'interrupted'].includes(attempt.status) &&
    attempt.finishedAt !== undefined
  );
}

function attemptMatchesExactAuthority(
  attempt: LoopSessionAttempt,
  input: NativeBrowserE2EAttestationInput
): boolean {
  return (
    attempt.purpose === 'browser-verification' &&
    attempt.phaseId === input.phase.id &&
    attempt.verificationRunId === input.verificationRunId &&
    attempt.checkpointBefore === input.checkpointCommit &&
    (attempt.checkpointAfter === undefined || attempt.checkpointAfter === input.checkpointCommit) &&
    sameTarget(attempt.target, input.target)
  );
}

function safeScreenshotMimeType(value: unknown): 'image/png' | 'image/jpeg' | undefined {
  if (value !== 'image/png' && value !== 'image/jpeg') return undefined;
  return safeText(value, 'invalid-mime', 128) === value ? value : undefined;
}

function isCanonicalAbsolutePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return false;
  if (value.includes('\u0000')) return false;
  if (posix.isAbsolute(value)) return posix.normalize(value) === value;
  if (win32.isAbsolute(value)) return win32.normalize(value) === value;
  return false;
}

function sameExactTarget(left: unknown, right: LoopSessionTarget): boolean {
  try {
    const parsed = loopSessionTargetSchema.safeParse(left);
    return (
      parsed.success && canonicalDeepEqual(left, parsed.data) && sameTarget(parsed.data, right)
    );
  } catch {
    return false;
  }
}

function sameExactStringRecord(left: unknown, right: Readonly<Record<string, string>>): boolean {
  try {
    if (!left || typeof left !== 'object' || Array.isArray(left)) return false;
    const entries = Object.entries(left);
    return (
      entries.every(([key, value]) => typeof value === 'string' && right[key] === value) &&
      entries.length === Object.keys(right).length
    );
  } catch {
    return false;
  }
}

function canonicalDeepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => canonicalDeepEqual(value, right[index]))
    );
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && canonicalDeepEqual(leftRecord[key], rightRecord[key])
    )
  );
}

function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function stabilizeJson(value: unknown, maxBytes: number): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > maxBytes)
      return undefined;
    return JSON.parse(serialized) as unknown;
  } catch {
    return undefined;
  }
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

function validErrorType(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/u.test(value);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== 'undefined' && value instanceof AbortSignal;
}

function signalAborted(signal: AbortSignal): boolean {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted');
    return descriptor?.get?.call(signal) === true;
  } catch {
    return true;
  }
}

function controlStopped(input: Pick<NativeBrowserE2EAttestationInput, 'signal' | 'deadlineAt'>) {
  return (
    (input.signal !== undefined && signalAborted(input.signal)) ||
    (input.deadlineAt !== undefined && Date.now() >= input.deadlineAt)
  );
}

function controlErrorType(
  input: Pick<NativeBrowserE2EAttestationInput, 'signal' | 'deadlineAt'>
): string {
  return input.signal !== undefined && signalAborted(input.signal)
    ? 'native-browser-cancelled'
    : 'native-browser-timed-out';
}

function controlErrorMessage(
  input: Pick<NativeBrowserE2EAttestationInput, 'signal' | 'deadlineAt'>
): string {
  return input.signal !== undefined && signalAborted(input.signal)
    ? 'Native browser attestation was cancelled before execution.'
    : 'Native browser attestation deadline expired before execution.';
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

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.trim() || value.length > 64) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function monotonicTimestamp(...values: string[]): string {
  let latest: { value: string; time: number } | undefined;
  for (const value of values) {
    if (!validTimestamp(value)) continue;
    const time = Date.parse(value);
    if (!latest || time > latest.time) latest = { value, time };
  }
  return latest?.value ?? new Date().toISOString();
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
