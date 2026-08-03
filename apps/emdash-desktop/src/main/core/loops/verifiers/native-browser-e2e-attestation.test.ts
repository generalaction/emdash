import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@main/lib/result';
import type { LoopPhaseState } from '@shared/core/loops/loop-phase-state';
import type { LoopSessionTarget, LoopState } from '@shared/core/loops/loop-state';
import type { Loop, LoopPhase, LoopPhaseCriterion } from '@shared/core/loops/loops';
import type { LoopSessionDriver } from '../drivers/session-driver';
import type { LoopEvidenceRunPort, LoopEvidenceScreenshot } from '../evidence/loop-evidence-store';
import type { LoopExecutionTarget } from '../runtime/loop-execution-target';
import {
  NativeBrowserE2EAttestationService,
  type NativeBrowserE2EAttestationDependencies,
  type NativeBrowserE2EExactSession,
  type NativeBrowserE2EAttestationInput,
} from './native-browser-e2e-attestation';
import type { LoopVerifier } from './types';

const BASE_COMMIT = '1'.repeat(40);
const CHECKPOINT_COMMIT = '2'.repeat(40);
const target: LoopSessionTarget = {
  workspaceId: 'loop-verify-1',
  path: '/tmp/loop-verify-1',
  machine: { kind: 'local' },
};
const taskEnvironment = Object.freeze({
  EMDASH_DEFAULT_BRANCH: 'main',
  EMDASH_PORT: '50100',
  EMDASH_ROOT_PATH: '/tmp/project',
  EMDASH_TASK_ID: 'task-1',
  EMDASH_TASK_NAME: 'Loop task',
  EMDASH_TASK_PATH: target.path,
});
const criteria: LoopPhaseCriterion[] = [
  {
    description: 'The native clean-room preview works.',
    verifier: 'agent-browser',
    status: 'pending',
  },
];
const loopState: LoopState = {
  version: '1',
  baseCommit: BASE_COMMIT,
  expectedFeatureHead: CHECKPOINT_COMMIT,
  checkpointCommit: CHECKPOINT_COMMIT,
  sessionAttempts: [],
  verification: null,
};
const phaseState: LoopPhaseState = {
  version: '2',
  checkpointCommit: CHECKPOINT_COMMIT,
  handoff: null,
  retryHandoffs: [],
  result: null,
};
const loop: Loop = {
  id: 'loop-1',
  projectId: 'project-1',
  taskId: 'task-1',
  name: 'Loop',
  slug: 'loop',
  status: 'running',
  currentPhaseIndex: 2,
  config: {
    version: '2',
    provider: 'codex',
    model: 'gpt-5.6-sol',
    validationCommands: ['pnpm run test'],
    planSource: 'test plan',
    terminalGates: { review: true, e2e: true },
    browserPreview: { enabled: true },
    reviewEnabled: true,
    verifiers: [],
  },
  state: loopState,
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
};
const phase: LoopPhase = {
  id: 'phase-e2e',
  loopId: loop.id,
  idx: 2,
  name: 'E2E',
  goal: 'Verify the complete change.',
  status: 'reviewing',
  attempts: 1,
  conversationId: 'outer-conversation',
  criteria: { version: '1', criteria },
  state: phaseState,
  lastError: null,
  kind: 'e2e',
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
};

function executionTarget(): LoopExecutionTarget {
  return {
    ...target,
    taskEnv: taskEnvironment,
    executionContext: { root: target.path } as never,
    dispose: vi.fn(),
  };
}

function input(): NativeBrowserE2EAttestationInput {
  return {
    loop,
    phase,
    verificationRunId: 'verification-run-1',
    sessionIdentity: {
      attemptId: 'browser-attempt-1',
      conversationId: 'browser-conversation-1',
    },
    outerConversationId: 'outer-conversation',
    target,
    executionTarget: executionTarget(),
    taskEnvironment,
    provider: 'codex',
    model: 'gpt-5.6-sol',
    checkpointCommit: CHECKPOINT_COMMIT,
    criteria,
  };
}

function recoveryDriver(cancelPrompt: LoopSessionDriver['cancelPrompt']): LoopSessionDriver {
  return {
    kind: 'acp',
    startPhaseSession: vi.fn(),
    startVerificationSession: vi.fn(),
    sendPrompt: vi.fn(),
    cancelPrompt,
  };
}

type ProductStatus = 'passed' | 'correctable' | 'failed';

function makeHarness(
  status: ProductStatus,
  options: {
    finish?: LoopEvidenceRunPort['finish'];
    abandon?: LoopEvidenceRunPort['abandon'];
    sessionIdentity?: { attemptId: string; conversationId: string };
    sessionOverrides?: Partial<NativeBrowserE2EExactSession>;
    cancelPrompt?: NativeBrowserE2EExactSession['driver']['cancelPrompt'];
    createVerifier?: NativeBrowserE2EAttestationDependencies['createVerifier'];
    now?: () => Date;
    outerSessionDriver?: NativeBrowserE2EAttestationDependencies['outerSessionDriver'];
    startExactSession?: NativeBrowserE2EAttestationDependencies['startExactSession'];
  } = {}
): {
  service: NativeBrowserE2EAttestationService;
  dependencies: NativeBrowserE2EAttestationDependencies;
  evidenceRun: LoopEvidenceRunPort;
} {
  const evidenceRun: LoopEvidenceRunPort = {
    directory: '/private/app-data/loops/evidence/opaque-run',
    appendObservation: vi.fn(async () => undefined),
    appendIntermediateFailure: vi.fn(async () => undefined),
    appendLeaseRotation: vi.fn(async () => undefined),
    writeScreenshot: vi.fn(
      async (): Promise<LoopEvidenceScreenshot> => ({
        artifactId: 'screenshot-1',
        mimeType: 'image/png',
        byteLength: 128,
        relativePath: 'screenshots/opaque.png',
      })
    ),
    finish: options.finish ?? vi.fn(async () => undefined),
    abandon: options.abandon ?? vi.fn(async () => undefined),
  };
  const startExactSession = vi.fn<NativeBrowserE2EAttestationDependencies['startExactSession']>(
    async (startInput) =>
      ok({
        attemptId: options.sessionIdentity?.attemptId ?? startInput.sessionIdentity.attemptId,
        conversationId:
          options.sessionIdentity?.conversationId ?? startInput.sessionIdentity.conversationId,
        purpose: 'browser-verification',
        phaseId: startInput.phase.id,
        title: 'Native E2E',
        verificationRunId: startInput.verificationRunId,
        target: startInput.target,
        taskEnvironment: startInput.taskEnvironment,
        provider: startInput.provider,
        model: startInput.model,
        checkpointCommit: startInput.checkpointCommit,
        driver: options.sessionOverrides?.driver ?? {
          kind: 'acp',
          startPhaseSession: vi.fn(),
          startVerificationSession: vi.fn(),
          sendPrompt: vi.fn(),
          cancelPrompt: options.cancelPrompt ?? vi.fn(async () => ok(undefined)),
        },
        ...options.sessionOverrides,
      })
  );
  const createVerifier = vi.fn<NativeBrowserE2EAttestationDependencies['createVerifier']>(
    (nativeDependencies): LoopVerifier => ({
      id: 'agent-browser',
      label: 'Native Browser Preview',
      checkAvailability: vi.fn(async () => ok({ available: true })),
      run: vi.fn<LoopVerifier['run']>(async (ctx) => {
        const binding = await nativeDependencies.resolveTrustedBinding({
          loop: ctx.loop,
          phase: ctx.phase,
          signal: ctx.signal ?? new AbortController().signal,
        });
        if (!binding.success) {
          return err({
            kind: 'invalid-config',
            verifierId: 'agent-browser',
            message: binding.error.message,
            cwd: ctx.cwd,
          });
        }
        const run = await nativeDependencies.evidenceStore.beginRun({
          loopId: ctx.loop.id,
          phaseId: ctx.phase.id,
          verificationRunId: binding.data.verificationRunId,
        });
        const session = await nativeDependencies.startVerificationSession({
          loop: ctx.loop,
          phase: ctx.phase,
          verificationRunId: binding.data.verificationRunId,
          target: binding.data.target,
          taskEnvironment: binding.data.taskEnvironment,
          signal: ctx.signal ?? new AbortController().signal,
        });
        if (!session.success) {
          return err({
            kind: 'command-failed',
            verifierId: 'agent-browser',
            message: session.error.message,
            cwd: ctx.cwd,
          });
        }
        await run.writeScreenshot({
          artifactId: 'screenshot-1',
          mimeType: 'image/png',
          data: Buffer.from('sensitive pixels'),
        });
        const evidenceStatus = status === 'correctable' ? 'correction-required' : status;
        const summary =
          status === 'passed'
            ? 'Native preview passed.'
            : status === 'correctable'
              ? 'Fix dialog state. token=must-not-persist'
              : 'Native preview failed.';
        await run.finish({ status: evidenceStatus, summary });
        if (status === 'passed') {
          return ok({
            verifierId: 'agent-browser',
            label: 'Native Browser Preview',
            command: 'ACP native browser verification',
            cwd: ctx.cwd,
            durationMs: 1,
            stdoutTail: '',
            stderrTail: '',
            exitCode: 0,
            summary: 'Native browser criteria passed.',
            evidencePath: run.directory,
          });
        }
        return err({
          kind: 'command-failed',
          verifierId: 'agent-browser',
          message:
            status === 'correctable'
              ? 'Native browser correction is required. See app-data evidence.'
              : 'Native browser criteria failed. See app-data evidence.',
          cwd: ctx.cwd,
          evidencePath: run.directory,
        });
      }),
    })
  );
  const dependencies: NativeBrowserE2EAttestationDependencies = {
    resolveTrustedBinding: vi.fn(async (bindingInput) =>
      ok({
        verificationRunId: 'verification-run-1',
        target,
        taskEnvironment,
        previewServerId: `preview-${bindingInput.phase.id}`,
      })
    ),
    startExactSession: options.startExactSession ?? startExactSession,
    browser: {
      start: vi.fn(),
      performAction: vi.fn(),
      reconcilePreview: vi.fn(),
      close: vi.fn(),
    },
    evidenceStore: { beginRun: vi.fn(async () => evidenceRun) },
    createVerifier: options.createVerifier ?? createVerifier,
    now: options.now ?? (() => new Date('2026-07-12T01:02:03.000Z')),
    ...(options.outerSessionDriver ? { outerSessionDriver: options.outerSessionDriver } : {}),
  };
  return {
    service: new NativeBrowserE2EAttestationService(dependencies),
    dependencies,
    evidenceRun,
  };
}

describe('NativeBrowserE2EAttestationService', () => {
  it.each(['passed', 'correctable', 'failed'] as const)(
    'returns an exact typed %s attestation without persisting evidence paths',
    async (status) => {
      const harness = makeHarness(status);

      const result = await harness.service.run(input());

      expect(result).toMatchObject({
        success: true,
        data: {
          status,
          invocationCount: 1,
          passed: status === 'passed',
          verificationRunId: 'verification-run-1',
          target,
          taskEnvironment,
          provider: 'codex',
          model: 'gpt-5.6-sol',
          checkpointCommit: CHECKPOINT_COMMIT,
          quiescent: true,
          sessionAttempt: {
            attemptId: 'browser-attempt-1',
            conversationId: 'browser-conversation-1',
            purpose: 'browser-verification',
            phaseId: phase.id,
            verificationRunId: 'verification-run-1',
            target,
            status: 'completed',
            checkpointBefore: CHECKPOINT_COMMIT,
            checkpointAfter: CHECKPOINT_COMMIT,
          },
          evidence: {
            runId: 'verification-run-1',
            artifacts: [
              {
                artifactId: 'screenshot-1',
                kind: 'screenshot',
                mimeType: 'image/png',
                byteLength: 128,
              },
            ],
          },
        },
      });
      if (!result.success) throw new Error('Expected a product attestation.');
      expect(result.data.handoff === undefined).toBe(status !== 'correctable');
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('/private/app-data');
      expect(serialized).not.toContain('sensitive pixels');
      expect(serialized).not.toContain('must-not-persist');
    }
  );

  it('passes and verifies the exact preallocated identity through the strict session seam', async () => {
    const harness = makeHarness('passed');
    const runInput = input();

    const result = await harness.service.run(runInput);

    expect(result.success).toBe(true);
    expect(harness.dependencies.startExactSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionIdentity: runInput.sessionIdentity,
        verificationRunId: runInput.verificationRunId,
        target,
        taskEnvironment,
        provider: 'codex',
        model: 'gpt-5.6-sol',
        checkpointCommit: CHECKPOINT_COMMIT,
      })
    );
  });

  it('stabilizes each raw exact-session success field once before authority validation', async () => {
    let attemptIdReads = 0;
    const cancelPrompt = vi.fn(async () => ok(undefined));
    const harness = makeHarness('passed', {
      startExactSession: vi.fn(async (startInput) => {
        const returned = {
          attemptId: startInput.sessionIdentity.attemptId,
          conversationId: startInput.sessionIdentity.conversationId,
          purpose: 'browser-verification' as const,
          phaseId: startInput.phase.id,
          title: 'Native E2E',
          verificationRunId: startInput.verificationRunId,
          target: startInput.target,
          taskEnvironment: startInput.taskEnvironment,
          provider: startInput.provider,
          model: startInput.model,
          checkpointCommit: startInput.checkpointCommit,
          driver: recoveryDriver(cancelPrompt),
        };
        Object.defineProperty(returned, 'attemptId', {
          enumerable: true,
          get: () => {
            attemptIdReads += 1;
            if (attemptIdReads > 1) throw new Error('attemptId was read twice');
            return startInput.sessionIdentity.attemptId;
          },
        });
        return ok(returned);
      }),
    });

    const result = await harness.service.run(input());

    expect(result).toMatchObject({ success: true });
    expect(attemptIdReads).toBe(1);
    expect(cancelPrompt).toHaveBeenCalledWith('browser-conversation-1');
  });

  it('rejects a session that does not adopt the preallocated identity', async () => {
    const harness = makeHarness('passed', {
      sessionIdentity: { attemptId: 'wrong-attempt', conversationId: 'wrong-conversation' },
    });

    const result = await harness.service.run(input());

    expect(result).toMatchObject({
      success: false,
      error: { type: 'session-authority-invalid', quiescent: true },
    });
    expect(result).toMatchObject({
      success: false,
      error: {
        sessionAttempts: expect.arrayContaining([
          expect.objectContaining({
            attemptId: 'wrong-attempt',
            conversationId: 'wrong-conversation',
            status: 'cancelled',
          }),
        ]),
      },
    });
  });

  it('does not attest quiescence until evidence finalization settles', async () => {
    const deferred = Promise.withResolvers<void>();
    const harness = makeHarness('passed', { finish: vi.fn(() => deferred.promise) });
    let settled = false;
    const run = harness.service.run(input()).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(harness.evidenceRun.finish).toHaveBeenCalledOnce());

    expect(settled).toBe(false);
    deferred.resolve();
    const result = await run;

    expect(result).toMatchObject({ success: true, data: { quiescent: true } });
  });

  it.each([
    ['returned failure', async () => err({ kind: 'cancel-failed' as const, message: 'no ack' })],
    ['rejection', async () => Promise.reject(new Error('no ack'))],
  ])(
    'does not claim quiescence or lose the actual identity after mismatched %s cancellation',
    async (_label, cancelPrompt) => {
      const cancellation = vi.fn(cancelPrompt);
      const harness = makeHarness('passed', {
        sessionIdentity: { attemptId: 'actual-attempt', conversationId: 'actual-conversation' },
        cancelPrompt: cancellation,
      });

      const result = await harness.service.run(input());

      expect(result).toMatchObject({
        success: false,
        error: {
          type: 'session-authority-invalid',
          quiescent: false,
          recoveryRequired: true,
          sessionAttempts: expect.arrayContaining([
            expect.objectContaining({
              attemptId: 'browser-attempt-1',
              conversationId: 'browser-conversation-1',
              status: 'interrupted',
            }),
            expect.objectContaining({
              attemptId: 'actual-attempt',
              conversationId: 'actual-conversation',
              status: 'interrupted',
            }),
          ]),
        },
      });
      expect(cancellation).toHaveBeenCalledWith('browser-conversation-1');
      expect(cancellation).toHaveBeenCalledWith('actual-conversation');
    }
  );

  it('cancels the accepted session and abandons evidence when the verifier throws', async () => {
    const cancellation = vi.fn(async () => ok(undefined));
    const finish = vi.fn(async () => Promise.reject(new Error('finish failed')));
    const abandon = vi.fn(async () => Promise.reject(new Error('abandon failed')));
    const harness = makeHarness('passed', {
      cancelPrompt: cancellation,
      finish,
      abandon,
      createVerifier: (nativeDependencies): LoopVerifier => ({
        id: 'agent-browser',
        label: 'throwing verifier',
        checkAvailability: vi.fn(async () => ok({ available: true })),
        run: vi.fn<LoopVerifier['run']>(async (ctx) => {
          await nativeDependencies.evidenceStore.beginRun({
            loopId: ctx.loop.id,
            phaseId: ctx.phase.id,
            verificationRunId: 'verification-run-1',
          });
          await nativeDependencies.startVerificationSession({
            loop: ctx.loop,
            phase: ctx.phase,
            verificationRunId: 'verification-run-1',
            target,
            taskEnvironment,
            signal: ctx.signal ?? new AbortController().signal,
          });
          throw new Error('verifier exploded');
        }),
      }),
    });

    const result = await harness.service.run(input());

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'native-browser-execution-error',
        quiescent: false,
        recoveryRequired: true,
        sessionAttempts: [expect.objectContaining({ status: 'cancelled' })],
      },
    });
    expect(cancellation).toHaveBeenCalledWith('browser-conversation-1');
    expect(finish).toHaveBeenCalledOnce();
    expect(abandon).toHaveBeenCalledOnce();
  });

  it('rejects a returned session that does not echo provider authority', async () => {
    const harness = makeHarness('passed', { sessionOverrides: { provider: 'claude' } });

    const result = await harness.service.run(input());

    expect(result).toMatchObject({
      success: false,
      error: { type: 'session-authority-invalid', quiescent: true },
    });
  });

  it('allows exactly one exact-session start invocation', async () => {
    const harness = makeHarness('passed', {
      createVerifier: (nativeDependencies): LoopVerifier => ({
        id: 'agent-browser',
        label: 'double starter',
        checkAvailability: vi.fn(async () => ok({ available: true })),
        run: vi.fn<LoopVerifier['run']>(async (ctx) => {
          const startInput = {
            loop: ctx.loop,
            phase: ctx.phase,
            verificationRunId: 'verification-run-1',
            target,
            taskEnvironment,
            signal: ctx.signal ?? new AbortController().signal,
          };
          await nativeDependencies.startVerificationSession(startInput);
          await nativeDependencies.startVerificationSession(startInput);
          return err({
            kind: 'command-failed' as const,
            verifierId: 'agent-browser',
            message: 'duplicate start',
            cwd: ctx.cwd,
          });
        }),
      }),
    });

    const result = await harness.service.run(input());

    expect(result).toMatchObject({
      success: false,
      error: { type: 'session-authority-invalid' },
    });
    expect(harness.dependencies.startExactSession).toHaveBeenCalledOnce();
  });

  it('preserves a typed browser-start failure before the exact ACP session begins', async () => {
    const harness = makeHarness('failed', {
      createVerifier: (nativeDependencies): LoopVerifier => ({
        id: 'agent-browser',
        label: 'browser-start failure',
        checkAvailability: vi.fn(async () => ok({ available: true })),
        run: vi.fn<LoopVerifier['run']>(async (ctx) => {
          const binding = await nativeDependencies.resolveTrustedBinding({
            loop: ctx.loop,
            phase: ctx.phase,
            signal: ctx.signal ?? new AbortController().signal,
          });
          if (!binding.success) throw new Error('Expected a trusted binding.');
          const run = await nativeDependencies.evidenceStore.beginRun({
            loopId: ctx.loop.id,
            phaseId: ctx.phase.id,
            verificationRunId: binding.data.verificationRunId,
          });
          await run.finish({
            status: 'failed',
            summary: 'Timed out waiting for the browser host',
          });
          return err({
            kind: 'command-failed',
            verifierId: 'agent-browser',
            message: 'Timed out waiting for the browser host',
            cwd: ctx.cwd,
          });
        }),
      }),
    });

    const result = await harness.service.run(input());

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'native-browser-rejected',
        message: 'Timed out waiting for the browser host',
        quiescent: true,
      },
    });
    expect(harness.dependencies.startExactSession).not.toHaveBeenCalled();
  });

  it.each([
    ['failure-atomic', true, false],
    ['recovery-required', false, true],
  ] as const)(
    'propagates an exact-session %s start failure without inventing quiescence',
    async (_label, quiescent, recoveryRequired) => {
      const harness = makeHarness('passed', {
        startExactSession: vi.fn(async () =>
          err({
            kind: 'create-failed',
            message: 'Exact start failed.',
            quiescent,
            recoveryRequired,
          })
        ),
      });

      const result = await harness.service.run(input());

      expect(result).toMatchObject({
        success: false,
        error: {
          quiescent,
          recoveryRequired,
          sessionAttempts: [
            expect.objectContaining({
              attemptId: 'browser-attempt-1',
              status: 'interrupted',
            }),
          ],
        },
      });
    }
  );

  it('preserves and concurrently recovers every reported nonterminal exact-start identity', async () => {
    const expectedCancellation = Promise.withResolvers<ReturnType<typeof ok<void>>>();
    const actualCancellation = Promise.withResolvers<ReturnType<typeof ok<void>>>();
    const cancelPrompt = vi.fn((conversationId: string) =>
      conversationId === 'browser-conversation-1'
        ? expectedCancellation.promise
        : actualCancellation.promise
    );
    const harness = makeHarness('passed', {
      outerSessionDriver: recoveryDriver(cancelPrompt),
      startExactSession: vi.fn<NativeBrowserE2EAttestationDependencies['startExactSession']>(
        async (startInput) =>
          err({
            kind: 'create-failed',
            message: 'Exact start returned recovery authority.',
            quiescent: false,
            recoveryRequired: true,
            sessionAttempts: [
              {
                attemptId: 'actual-browser-attempt',
                conversationId: 'actual-browser-conversation',
                purpose: 'browser-verification',
                phaseId: startInput.phase.id,
                verificationRunId: startInput.verificationRunId,
                target: startInput.target,
                status: 'running',
                checkpointBefore: startInput.checkpointCommit,
                startedAt: '2026-07-12T01:02:02.000Z',
              },
            ],
          })
      ),
    });
    let returned = false;
    const run = harness.service.run(input()).then((result) => {
      returned = true;
      return result;
    });

    await vi.waitFor(() => expect(cancelPrompt).toHaveBeenCalledTimes(2));
    expect(cancelPrompt).toHaveBeenCalledWith('browser-conversation-1');
    expect(cancelPrompt).toHaveBeenCalledWith('actual-browser-conversation');
    expect(returned).toBe(false);
    expectedCancellation.resolve(ok(undefined));
    actualCancellation.resolve(ok(undefined));
    const result = await run;

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'session-authority-invalid',
        quiescent: true,
        recoveryRequired: false,
        sessionAttempts: expect.arrayContaining([
          expect.objectContaining({
            attemptId: 'browser-attempt-1',
            status: 'cancelled',
          }),
          expect.objectContaining({
            attemptId: 'actual-browser-attempt',
            status: 'cancelled',
          }),
        ]),
      },
    });
  });

  it('retains every reported actual identity when recovery also knows the preallocated identity', async () => {
    const cancelPrompt = vi.fn(async () => ok(undefined));
    const harness = makeHarness('passed', {
      outerSessionDriver: recoveryDriver(cancelPrompt),
      startExactSession: vi.fn<NativeBrowserE2EAttestationDependencies['startExactSession']>(
        async (startInput) =>
          err({
            kind: 'create-failed',
            message: 'Exact start allocated the maximum reported actual identities.',
            quiescent: false,
            recoveryRequired: true,
            sessionAttempts: Array.from({ length: 64 }, (_, index) => ({
              attemptId: `actual-browser-attempt-${index}`,
              conversationId: `actual-browser-conversation-${index}`,
              purpose: 'browser-verification' as const,
              phaseId: startInput.phase.id,
              verificationRunId: startInput.verificationRunId,
              target: startInput.target,
              status: 'running' as const,
              checkpointBefore: startInput.checkpointCommit,
              startedAt: '2026-07-12T01:02:02.000Z',
            })),
          })
      ),
    });

    const result = await harness.service.run(input());

    expect(cancelPrompt).toHaveBeenCalledTimes(65);
    expect(cancelPrompt).toHaveBeenCalledWith('browser-conversation-1');
    for (let index = 0; index < 64; index += 1) {
      expect(cancelPrompt).toHaveBeenCalledWith(`actual-browser-conversation-${index}`);
    }
    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'session-authority-invalid',
        quiescent: false,
        recoveryRequired: true,
      },
    });
    if (result.success) throw new Error('Expected recovery-required native authority.');
    expect(result.error.sessionAttempts).toHaveLength(64);
    expect(result.error.sessionAttempts).not.toContainEqual(
      expect.objectContaining({ attemptId: 'browser-attempt-1' })
    );
    for (let index = 0; index < 64; index += 1) {
      expect(result.error.sessionAttempts).toContainEqual(
        expect.objectContaining({
          attemptId: `actual-browser-attempt-${index}`,
          conversationId: `actual-browser-conversation-${index}`,
          status: 'cancelled',
        })
      );
    }
  });

  it('treats duplicate reported start identities as incomplete authority', async () => {
    const cancelPrompt = vi.fn(async () => ok(undefined));
    const harness = makeHarness('passed', {
      outerSessionDriver: recoveryDriver(cancelPrompt),
      startExactSession: vi.fn<NativeBrowserE2EAttestationDependencies['startExactSession']>(
        async (startInput) => {
          const duplicate = {
            attemptId: 'duplicate-browser-attempt',
            conversationId: 'duplicate-browser-conversation',
            purpose: 'browser-verification' as const,
            phaseId: startInput.phase.id,
            verificationRunId: startInput.verificationRunId,
            target: startInput.target,
            status: 'failed' as const,
            checkpointBefore: startInput.checkpointCommit,
            startedAt: '2026-07-12T01:02:01.000Z',
            finishedAt: '2026-07-12T01:02:02.000Z',
            error: 'Start failed after allocating an identity.',
          };
          return err({
            kind: 'create-failed',
            message: 'Exact start returned duplicate terminal authority.',
            quiescent: true,
            recoveryRequired: false,
            sessionAttempts: [duplicate, duplicate],
          });
        }
      ),
    });

    const result = await harness.service.run(input());

    expect(cancelPrompt).toHaveBeenCalledTimes(2);
    expect(cancelPrompt).toHaveBeenCalledWith('browser-conversation-1');
    expect(cancelPrompt).toHaveBeenCalledWith('duplicate-browser-conversation');
    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'session-authority-invalid',
        quiescent: false,
        recoveryRequired: true,
        sessionAttempts: expect.arrayContaining([
          expect.objectContaining({
            attemptId: 'duplicate-browser-attempt',
            status: 'cancelled',
          }),
        ]),
      },
    });
  });

  it('cancels every terminal-shaped actual identity from an explicitly nonquiescent start', async () => {
    const cancelPrompt = vi.fn(async () => ok(undefined));
    const harness = makeHarness('passed', {
      outerSessionDriver: recoveryDriver(cancelPrompt),
      startExactSession: vi.fn<NativeBrowserE2EAttestationDependencies['startExactSession']>(
        async (startInput) =>
          err({
            kind: 'create-failed',
            message: 'Exact start reported a terminal-shaped identity but requires recovery.',
            quiescent: false,
            recoveryRequired: true,
            sessionAttempts: [
              {
                attemptId: 'terminal-actual-attempt',
                conversationId: 'terminal-actual-conversation',
                purpose: 'browser-verification',
                phaseId: startInput.phase.id,
                verificationRunId: startInput.verificationRunId,
                target: startInput.target,
                status: 'failed',
                checkpointBefore: startInput.checkpointCommit,
                startedAt: '2026-07-12T01:02:01.000Z',
                finishedAt: '2026-07-12T01:02:02.000Z',
                error: 'Start failed after allocating the actual identity.',
              },
            ],
          })
      ),
    });

    const result = await harness.service.run(input());

    expect(cancelPrompt).toHaveBeenCalledTimes(2);
    expect(cancelPrompt).toHaveBeenCalledWith('browser-conversation-1');
    expect(cancelPrompt).toHaveBeenCalledWith('terminal-actual-conversation');
    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'session-authority-invalid',
        quiescent: true,
        recoveryRequired: false,
        sessionAttempts: expect.arrayContaining([
          expect.objectContaining({
            attemptId: 'browser-attempt-1',
            conversationId: 'browser-conversation-1',
            status: 'cancelled',
          }),
          expect.objectContaining({
            attemptId: 'terminal-actual-attempt',
            conversationId: 'terminal-actual-conversation',
            status: 'cancelled',
          }),
        ]),
      },
    });
  });

  it('retains a distinct actual identity when hostile driver property access throws', async () => {
    const hostileDriver = {
      kind: 'acp',
      startPhaseSession: vi.fn(),
      startVerificationSession: vi.fn(),
      sendPrompt: vi.fn(),
    } as unknown as LoopSessionDriver;
    Object.defineProperty(hostileDriver, 'cancelPrompt', {
      enumerable: true,
      get: () => {
        throw new Error('hostile cancelPrompt getter');
      },
    });
    const harness = makeHarness('passed', {
      sessionIdentity: {
        attemptId: 'hostile-driver-actual-attempt',
        conversationId: 'hostile-driver-actual-conversation',
      },
      sessionOverrides: { driver: hostileDriver },
    });

    const result = await harness.service.run(input());

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'session-authority-invalid',
        quiescent: false,
        recoveryRequired: true,
        sessionAttempts: expect.arrayContaining([
          expect.objectContaining({
            attemptId: 'browser-attempt-1',
            conversationId: 'browser-conversation-1',
            status: 'interrupted',
          }),
          expect.objectContaining({
            attemptId: 'hostile-driver-actual-attempt',
            conversationId: 'hostile-driver-actual-conversation',
            status: 'interrupted',
          }),
        ]),
      },
    });
  });

  it('samples recovered-session finishedAt only after all cancellation acknowledgements settle', async () => {
    const cancellation = Promise.withResolvers<ReturnType<typeof ok<void>>>();
    const cancelPrompt = vi.fn(() => cancellation.promise);
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date('2026-07-12T01:00:00.000Z'))
      .mockReturnValue(new Date('2026-07-12T02:00:00.000Z'));
    const harness = makeHarness('passed', {
      now,
      outerSessionDriver: recoveryDriver(cancelPrompt),
      startExactSession: vi.fn(async () =>
        err({
          kind: 'create-failed',
          message: 'Exact start requires acknowledged cancellation.',
          quiescent: false,
          recoveryRequired: true,
        })
      ),
    });
    let returned = false;
    const run = harness.service.run(input()).then((result) => {
      returned = true;
      return result;
    });

    await vi.waitFor(() => expect(cancelPrompt).toHaveBeenCalledOnce());
    expect(now).toHaveBeenCalledTimes(1);
    expect(returned).toBe(false);
    cancellation.resolve(ok(undefined));
    const result = await run;

    expect(now).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      success: false,
      error: {
        quiescent: true,
        sessionAttempts: [
          expect.objectContaining({
            startedAt: '2026-07-12T01:00:00.000Z',
            finishedAt: '2026-07-12T02:00:00.000Z',
          }),
        ],
      },
    });
  });

  it('salvages cancellation authority from a malformed nonterminal start attempt', async () => {
    const cancelPrompt = vi.fn(async () => ok(undefined));
    const harness = makeHarness('passed', {
      outerSessionDriver: recoveryDriver(cancelPrompt),
      startExactSession: vi.fn<NativeBrowserE2EAttestationDependencies['startExactSession']>(
        async (startInput) =>
          err({
            kind: 'create-failed',
            message: 'Exact start returned malformed recovery authority.',
            quiescent: false,
            recoveryRequired: true,
            sessionAttempts: [
              {
                attemptId: 'salvaged-actual-attempt',
                conversationId: 'salvaged-actual-conversation',
                purpose: 'browser-verification',
                phaseId: startInput.phase.id,
                verificationRunId: startInput.verificationRunId,
                target: startInput.target,
                status: 'launching',
                checkpointBefore: startInput.checkpointCommit,
                startedAt: '2026-07-12T01:02:02.000Z',
              } as never,
            ],
          })
      ),
    });

    const result = await harness.service.run(input());

    expect(cancelPrompt).toHaveBeenCalledWith('browser-conversation-1');
    expect(cancelPrompt).toHaveBeenCalledWith('salvaged-actual-conversation');
    expect(result).toMatchObject({
      success: false,
      error: {
        quiescent: false,
        recoveryRequired: true,
        sessionAttempts: expect.arrayContaining([
          expect.objectContaining({
            attemptId: 'salvaged-actual-attempt',
            status: 'cancelled',
          }),
        ]),
      },
    });
  });

  it.each(['passed', 'correctable', 'failed'] as const)(
    'waits for exact accepted-session quiescence before returning a typed %s outcome',
    async (status) => {
      const cancellation = Promise.withResolvers<ReturnType<typeof ok<void>>>();
      const cancelPrompt = vi.fn(() => cancellation.promise);
      const harness = makeHarness(status, { cancelPrompt });
      let returned = false;
      const run = harness.service.run(input()).then((result) => {
        returned = true;
        return result;
      });

      await vi.waitFor(() => expect(cancelPrompt).toHaveBeenCalledOnce());
      expect(returned).toBe(false);
      cancellation.resolve(ok(undefined));

      await expect(run).resolves.toMatchObject({
        success: true,
        data: { status, quiescent: true },
      });
    }
  );

  it.each(['passed', 'correctable', 'failed'] as const)(
    'rejects a typed %s outcome when accepted-session settlement is not acknowledged',
    async (status) => {
      const harness = makeHarness(status, {
        cancelPrompt: vi.fn(async () =>
          err({ kind: 'cancel-failed' as const, message: 'not settled' })
        ),
      });

      const result = await harness.service.run(input());

      expect(result).toMatchObject({
        success: false,
        error: {
          type: 'native-browser-quiescence-failed',
          quiescent: false,
          recoveryRequired: true,
          sessionAttempts: [expect.objectContaining({ status: 'interrupted' })],
        },
      });
    }
  );

  it('snapshots every raw top-level input field once before validation or effects', async () => {
    const harness = makeHarness('passed');
    const raw = input();
    let targetReads = 0;
    const stateful = Object.defineProperty({ ...raw }, 'target', {
      enumerable: true,
      get: () => {
        targetReads += 1;
        if (targetReads > 1) throw new Error('target authority was read twice');
        return target;
      },
    }) as NativeBrowserE2EAttestationInput;

    const result = await harness.service.run(stateful);

    expect(result).toMatchObject({ success: true });
    expect(targetReads).toBe(1);
  });

  it.each(['relative/worktree', '/tmp/worktree/../escape'])(
    'rejects noncanonical clean-room path %s before dependency effects',
    async (path) => {
      const harness = makeHarness('passed');
      const runInput = input();
      runInput.target = { ...target, path };
      runInput.executionTarget = {
        ...runInput.executionTarget,
        path,
        taskEnv: { ...taskEnvironment, EMDASH_TASK_PATH: path },
      };
      runInput.taskEnvironment = { ...taskEnvironment, EMDASH_TASK_PATH: path };

      const result = await harness.service.run(runInput);

      expect(result).toMatchObject({
        success: false,
        error: { type: 'native-browser-input-invalid', quiescent: true },
      });
      expect(harness.dependencies.resolveTrustedBinding).not.toHaveBeenCalled();
      expect(harness.dependencies.startExactSession).not.toHaveBeenCalled();
    }
  );

  it('rejects and redacts hostile screenshot MIME metadata', async () => {
    const harness = makeHarness('passed');
    vi.mocked(harness.evidenceRun.writeScreenshot).mockResolvedValueOnce({
      artifactId: 'screenshot-1',
      mimeType: 'image/png; token=secret /private/leak' as 'image/png',
      byteLength: 128,
      relativePath: 'screenshots/opaque.png',
    });

    const result = await harness.service.run(input());

    expect(result).toMatchObject({
      success: false,
      error: { type: 'native-browser-execution-error' },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('/private/leak');
  });

  it('rejects an expired deadline before any dependency effect', async () => {
    const harness = makeHarness('passed');
    const runInput = input();
    runInput.deadlineAt = Date.now() - 1;

    const result = await harness.service.run(runInput);

    expect(result).toMatchObject({
      success: false,
      error: { quiescent: true, recoveryRequired: false },
    });
    expect(harness.dependencies.resolveTrustedBinding).not.toHaveBeenCalled();
    expect(harness.dependencies.startExactSession).not.toHaveBeenCalled();
  });

  it('rejects hostile input getters before any dependency effect', async () => {
    const harness = makeHarness('passed');
    const hostile = new Proxy(input(), {
      get(targetValue, property, receiver) {
        if (property === 'target') throw new Error('hostile getter');
        return Reflect.get(targetValue, property, receiver);
      },
    });

    const result = await harness.service.run(hostile);

    expect(result).toMatchObject({
      success: false,
      error: { type: 'native-browser-input-invalid', quiescent: true },
    });
    expect(harness.dependencies.resolveTrustedBinding).not.toHaveBeenCalled();
  });

  it('keeps terminal attempt timestamps monotonic when the clock moves backward', async () => {
    const timestamps = [
      new Date('2026-07-12T02:00:00.000Z'),
      new Date('2026-07-12T01:00:00.000Z'),
      new Date('2026-07-12T01:00:00.000Z'),
    ];
    const harness = makeHarness('passed', { now: () => timestamps.shift() ?? timestamps[0]! });

    const result = await harness.service.run(input());

    expect(result).toMatchObject({ success: true });
    if (!result.success) throw new Error('Expected an attestation.');
    expect(Date.parse(result.data.sessionAttempt.finishedAt!)).toBeGreaterThanOrEqual(
      Date.parse(result.data.sessionAttempt.startedAt)
    );
  });

  it('keeps evidence artifacts and correction handoff chronology monotonic under clock rollback', async () => {
    const timestamps = [
      new Date('2026-07-12T04:00:00.000Z'),
      new Date('2026-07-12T03:00:00.000Z'),
      new Date('2026-07-12T02:00:00.000Z'),
      new Date('2026-07-12T01:00:00.000Z'),
    ];
    let timestampIndex = 0;
    const harness = makeHarness('correctable', {
      now: () => timestamps[Math.min(timestampIndex++, timestamps.length - 1)]!,
    });

    const result = await harness.service.run(input());

    expect(result).toMatchObject({ success: true, data: { status: 'correctable' } });
    if (!result.success || !result.data.handoff) {
      throw new Error('Expected a correction handoff.');
    }
    const artifactCreatedAt = result.data.evidence.artifacts[0]?.createdAt;
    if (!artifactCreatedAt) throw new Error('Expected native screenshot evidence.');
    expect(Date.parse(artifactCreatedAt)).toBeGreaterThanOrEqual(
      Date.parse(result.data.sessionAttempt.startedAt)
    );
    expect(Date.parse(result.data.handoff.handoff.createdAt)).toBeGreaterThanOrEqual(
      Date.parse(artifactCreatedAt)
    );
    expect(Date.parse(result.data.sessionAttempt.finishedAt!)).toBeGreaterThanOrEqual(
      Date.parse(result.data.handoff.handoff.createdAt)
    );
  });
});
