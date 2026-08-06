import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@main/lib/result';
import type { LoopPhaseState } from '@shared/core/loops/loop-phase-state';
import type {
  LoopSessionAttempt,
  LoopSessionTarget,
  LoopStateV2,
} from '@shared/core/loops/loop-state';
import type { Loop, LoopPhase, LoopPhaseCriterion } from '@shared/core/loops/loops';
import type { LoopExecutionTarget } from '../runtime/loop-execution-target';
import type {
  NativeBrowserE2EAttestation,
  NativeBrowserE2EAttestationPort,
} from '../verifiers/native-browser-e2e-attestation';
import type { LoopVerifier } from '../verifiers/types';
import type { E2ERequiredChecksPort } from './clean-room-e2e-gate';
import { CleanRoomE2ERequiredChecksAdapter } from './clean-room-e2e-required-checks';

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
const validationCommands = ['pnpm run test', 'pnpm run typecheck'];
const criteria: LoopPhaseCriterion[] = [
  {
    description: 'The native clean-room preview works.',
    verifier: 'agent-browser',
    status: 'pending',
  },
];
const loopState: LoopStateV2 = {
  version: '2',
  baseCommit: BASE_COMMIT,
  expectedFeatureHead: CHECKPOINT_COMMIT,
  checkpointCommit: CHECKPOINT_COMMIT,
  e2eAttemptsConsumed: 1,
  sessionAttempts: [
    {
      attemptId: 'browser-attempt-1',
      conversationId: 'browser-conversation-1',
      purpose: 'browser-verification',
      phaseId: 'phase-e2e',
      verificationRunId: 'verification-run-1',
      target,
      status: 'starting',
      checkpointBefore: CHECKPOINT_COMMIT,
      startedAt: '2026-07-12T01:00:00.000Z',
    },
  ],
  verification: {
    verificationRunId: 'verification-run-1',
    attempt: 1,
    status: 'running',
    target,
    baseCommit: BASE_COMMIT,
    replayedThroughCommit: CHECKPOINT_COMMIT,
    expectedFeatureHead: CHECKPOINT_COMMIT,
    cleanup: { status: 'pending', updatedAt: '2026-07-12T01:00:00.000Z' },
  },
};
const phaseState: LoopPhaseState = {
  version: '2',
  checkpointCommit: CHECKPOINT_COMMIT,
  handoff: null,
  retryHandoffs: [],
  result: null,
};
const retryPhaseState: LoopPhaseState = {
  ...phaseState,
  retryHandoffs: [
    {
      source: 'Prior clean-room correction',
      handoff: {
        summary: 'The prior clean-room attempt requested one correction.',
        risks: ['The current checkpoint still needs native verification.'],
        remainingWork: ['Verify the corrected checkpoint.'],
        artifacts: [],
        createdAt: '2026-07-12T00:30:00.000Z',
      },
    },
  ],
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
    validationCommands,
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

function input(): Parameters<E2ERequiredChecksPort['run']>[0] {
  return {
    authority: {
      loopId: loop.id,
      projectId: loop.projectId,
      taskId: loop.taskId,
      phaseId: phase.id,
      outerConversationId: 'outer-conversation',
      progress: { loopState, phaseState },
    },
    validationCommands,
    criteria,
    verificationRunId: 'verification-run-1',
    attempt: 1,
    sessionIdentity: {
      attemptId: 'browser-attempt-1',
      conversationId: 'browser-conversation-1',
    },
    target,
    executionTarget: executionTarget(),
    taskEnvironment,
    checkpointCommit: CHECKPOINT_COMMIT,
    provider: 'codex',
    model: 'gpt-5.6-sol',
  };
}

function sessionAttempt(status: LoopSessionAttempt['status'] = 'completed'): LoopSessionAttempt {
  return {
    attemptId: 'browser-attempt-1',
    conversationId: 'browser-conversation-1',
    purpose: 'browser-verification',
    phaseId: phase.id,
    verificationRunId: 'verification-run-1',
    target,
    status,
    checkpointBefore: CHECKPOINT_COMMIT,
    ...(status === 'completed' ? { checkpointAfter: CHECKPOINT_COMMIT } : {}),
    startedAt: '2026-07-12T01:01:00.000Z',
    finishedAt: '2026-07-12T01:01:30.000Z',
  };
}

function attestation(status: 'passed' | 'correctable' | 'failed'): NativeBrowserE2EAttestation {
  const artifact = {
    artifactId: 'native-screenshot',
    kind: 'screenshot' as const,
    mimeType: 'image/png',
    byteLength: 128,
    createdAt: '2026-07-12T01:01:30.000Z',
  };
  return {
    status,
    summary:
      status === 'passed'
        ? 'Native preview passed.'
        : status === 'correctable'
          ? 'The dialog needs a correction.'
          : 'Native preview failed.',
    invocationCount: 1,
    passed: status === 'passed',
    verificationRunId: 'verification-run-1',
    target,
    taskEnvironment,
    provider: 'codex',
    model: 'gpt-5.6-sol',
    checkpointCommit: CHECKPOINT_COMMIT,
    sessionAttempt: sessionAttempt(),
    evidence: { runId: 'verification-run-1', artifacts: [artifact] },
    ...(status === 'correctable'
      ? {
          handoff: {
            source: 'Native browser verification',
            handoff: {
              summary: 'The dialog needs a correction.',
              risks: ['The correction requires a fresh replay.'],
              remainingWork: ['Fix the dialog and rerun the clean-room checks.'],
              artifacts: [artifact],
              createdAt: '2026-07-12T01:01:30.000Z',
            },
          },
        }
      : {}),
    quiescent: true,
  };
}

function makeHarness(
  options: {
    nativeStatus?: 'passed' | 'correctable' | 'failed';
    validationFails?: boolean;
    nativeRun?: NativeBrowserE2EAttestationPort['run'];
    context?: { loop: Loop; phase: LoopPhase };
  } = {}
) {
  const validationVerifier: LoopVerifier = {
    id: 'unit-tests',
    label: 'Unit tests',
    checkAvailability: vi.fn(async () => ok({ available: true })),
    run: vi.fn<LoopVerifier['run']>(async (ctx) =>
      options.validationFails
        ? err({
            kind: 'command-failed',
            verifierId: 'unit-tests',
            message: 'Validation command failed.',
            cwd: ctx.cwd,
          })
        : ok({
            verifierId: 'unit-tests',
            label: 'Unit tests',
            command: ctx.validationCommands.join(' && '),
            cwd: ctx.cwd,
            durationMs: 1,
            stdoutTail: '',
            stderrTail: '',
            exitCode: 0,
            summary: 'Validation commands passed.',
          })
    ),
  };
  const native: NativeBrowserE2EAttestationPort = {
    run: options.nativeRun ?? vi.fn(async () => ok(attestation(options.nativeStatus ?? 'passed'))),
  };
  const resolveContext = vi.fn(async () => ok(options.context ?? { loop, phase }));
  const adapter = new CleanRoomE2ERequiredChecksAdapter({
    resolveContext,
    validationVerifier,
    native,
    now: () => new Date('2026-07-12T01:02:03.000Z'),
  });
  return { adapter, native, resolveContext, validationVerifier };
}

describe('CleanRoomE2ERequiredChecksAdapter', () => {
  it('accepts a cleared phase binding when the exact running outer E2E attempt is durable', async () => {
    const outerAttempt: LoopSessionAttempt = {
      attemptId: 'outer-attempt-1',
      conversationId: 'outer-conversation',
      purpose: 'e2e',
      phaseId: phase.id,
      verificationRunId: 'verification-run-1',
      target,
      status: 'running',
      checkpointBefore: CHECKPOINT_COMMIT,
      startedAt: '2026-07-12T00:59:00.000Z',
    };
    const detachedLoopState: LoopStateV2 = {
      ...loopState,
      sessionAttempts: [outerAttempt, ...loopState.sessionAttempts],
    };
    const detachedLoop: Loop = { ...loop, state: detachedLoopState };
    const detachedPhase: LoopPhase = { ...phase, conversationId: null };
    const harness = makeHarness({ context: { loop: detachedLoop, phase: detachedPhase } });
    const runInput = input();
    runInput.authority.progress = {
      loopState: detachedLoopState,
      phaseState,
    };

    const result = await harness.adapter.run(runInput);

    expect(result.success).toBe(true);
  });

  it('rejects a cleared phase binding without the exact durable outer E2E attempt', async () => {
    const harness = makeHarness({
      context: { loop, phase: { ...phase, conversationId: null } },
    });

    const result = await harness.adapter.run(input());

    expect(result).toMatchObject({
      success: false,
      error: { type: 'required-checks-context-invalid', quiescent: true },
    });
  });

  it.each(['passed', 'correctable', 'failed'] as const)(
    'maps exact validation plus one native %s attestation',
    async (nativeStatus) => {
      const harness = makeHarness({ nativeStatus });
      const runInput = input();

      const result = await harness.adapter.run(runInput);

      expect(result).toMatchObject({
        success: true,
        data: {
          status: nativeStatus,
          loopId: loop.id,
          phaseId: phase.id,
          fullChecksRan: true,
          verificationRunId: 'verification-run-1',
          attempt: 1,
          outerConversationId: 'outer-conversation',
          target,
          executionTarget: target,
          checkpointCommit: CHECKPOINT_COMMIT,
          provider: 'codex',
          model: 'gpt-5.6-sol',
          validationCommands,
          criteria,
          taskEnvironment,
          nativeBrowserRan: true,
          nativePreview: {
            invocationCount: 1,
            passed: nativeStatus === 'passed',
            target,
            provider: 'codex',
            model: 'gpt-5.6-sol',
            taskEnvironment,
          },
          nativeEvidence: {
            runId: 'verification-run-1',
            artifacts: [expect.objectContaining({ artifactId: 'native-screenshot' })],
          },
          sessionAttempts: [{ attemptId: 'browser-attempt-1', status: 'completed' }],
        },
      });
      if (!result.success) throw new Error('Expected required-check result.');
      expect(result.data.handoff === undefined).toBe(nativeStatus !== 'correctable');
      expect(harness.native.run).toHaveBeenCalledOnce();
      expect(harness.validationVerifier.run).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: target.path,
          executionTarget: expect.objectContaining({
            workspaceId: target.workspaceId,
            path: target.path,
            machine: target.machine,
            taskEnv: taskEnvironment,
          }),
          validationCommands,
          criteria,
          signal: expect.any(AbortSignal),
        })
      );
      expect(harness.native.run).toHaveBeenCalledWith(
        expect.objectContaining({
          loop,
          phase: expect.objectContaining({ conversationId: 'outer-conversation' }),
          sessionIdentity: runInput.sessionIdentity,
          target,
          taskEnvironment,
          provider: 'codex',
          model: 'gpt-5.6-sol',
          checkpointCommit: CHECKPOINT_COMMIT,
          signal: expect.any(AbortSignal),
        })
      );
    }
  );

  it.each([
    ['a normal first attempt with null phase state', null],
    ['the exact current retry phase state', retryPhaseState],
  ] as const)('composes required checks from %s', async (_label, currentPhaseState) => {
    const harness = makeHarness();
    const runInput = input();
    runInput.authority.progress = {
      loopState,
      phaseState: currentPhaseState,
    };
    harness.resolveContext.mockResolvedValueOnce(
      ok({
        loop,
        phase: { ...phase, state: currentPhaseState },
      })
    );

    const result = await harness.adapter.run(runInput);

    expect(result).toMatchObject({ success: true, data: { status: 'passed' } });
    expect(harness.native.run).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: expect.objectContaining({ state: currentPhaseState }),
      })
    );
  });

  it('runs native verification once even when validation commands fail, then returns failed', async () => {
    const harness = makeHarness({ validationFails: true, nativeStatus: 'correctable' });

    const result = await harness.adapter.run(input());

    expect(result).toMatchObject({
      success: true,
      data: {
        status: 'failed',
        fullChecksRan: true,
        nativeBrowserRan: true,
        nativePreview: { invocationCount: 1, passed: false },
      },
    });
    if (!result.success) throw new Error('Expected a failed full-check result.');
    expect(result.data).not.toHaveProperty('handoff');
    expect(harness.native.run).toHaveBeenCalledOnce();
  });

  it('preserves exact terminal nested authority from native infrastructure failure', async () => {
    const attempt = sessionAttempt('interrupted');
    const harness = makeHarness({
      nativeRun: vi.fn<NativeBrowserE2EAttestationPort['run']>(async () =>
        err({
          type: 'native-browser-rejected',
          message: 'Native browser cleanup failed.',
          quiescent: true,
          recoveryRequired: false,
          sessionAttempts: [attempt],
        })
      ),
    });

    const result = await harness.adapter.run(input());

    expect(result).toEqual(
      err({
        type: 'native-browser-rejected',
        message: 'Native browser cleanup failed.',
        quiescent: true,
        recoveryRequired: false,
        sessionAttempts: [attempt],
      })
    );
  });

  it('rejects context authority drift before validation or native execution', async () => {
    const harness = makeHarness();
    harness.resolveContext.mockResolvedValueOnce(
      ok({ loop: { ...loop, id: 'wrong-loop' }, phase })
    );

    const result = await harness.adapter.run(input());

    expect(result).toMatchObject({
      success: false,
      error: { type: 'required-checks-context-invalid' },
    });
    expect(harness.validationVerifier.run).not.toHaveBeenCalled();
    expect(harness.native.run).not.toHaveBeenCalled();
  });

  it('does not settle while the native attestation remains in cleanup', async () => {
    type NativeRunResult = Awaited<ReturnType<NativeBrowserE2EAttestationPort['run']>>;
    const deferred = Promise.withResolvers<NativeRunResult>();
    const harness = makeHarness({ nativeRun: vi.fn(() => deferred.promise) });
    let settled = false;
    const run = harness.adapter.run(input()).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(harness.native.run).toHaveBeenCalledOnce());

    expect(settled).toBe(false);
    deferred.resolve(ok(attestation('passed')));
    const result = await run;

    expect(result).toMatchObject({ success: true, data: { status: 'passed' } });
  });

  it.each([
    ['verificationRunId', 'wrong-run'],
    ['checkpointCommit', '3'.repeat(40)],
    ['provider', 'claude'],
    ['model', 'wrong-model'],
    ['quiescent', false],
  ] as const)('rejects drifted raw native %s authority', async (field, value) => {
    const harness = makeHarness({
      nativeRun: vi.fn(async () => ok({ ...attestation('passed'), [field]: value } as never)),
    });

    const result = await harness.adapter.run(input());

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'native-browser-authority-invalid',
        quiescent: false,
        recoveryRequired: true,
      },
    });
  });

  it('rejects normalized nested identity aliases instead of trimming them', async () => {
    const raw = attestation('passed');
    const harness = makeHarness({
      nativeRun: vi.fn(async () =>
        ok({
          ...raw,
          sessionAttempt: { ...raw.sessionAttempt, attemptId: ' browser-attempt-1 ' },
        } as never)
      ),
    });

    const result = await harness.adapter.run(input());

    expect(result).toMatchObject({
      success: false,
      error: { type: 'native-browser-authority-invalid', quiescent: false },
    });
  });

  it('propagates non-quiescent native recovery with the actual nested identity', async () => {
    const actual = {
      ...sessionAttempt('interrupted'),
      attemptId: 'actual-attempt',
      conversationId: 'actual-conversation',
    };
    const harness = makeHarness({
      nativeRun: vi.fn(async () =>
        err({
          type: 'native-browser-cleanup-failed',
          message: 'Cleanup failed at /private/app-data/loops/evidence/run token=secret',
          quiescent: false,
          recoveryRequired: true,
          sessionAttempts: [actual],
        })
      ),
    });

    const result = await harness.adapter.run(input());

    expect(result).toMatchObject({
      success: false,
      error: {
        quiescent: false,
        recoveryRequired: true,
        sessionAttempts: [
          expect.objectContaining({
            attemptId: 'actual-attempt',
            conversationId: 'actual-conversation',
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('/private/app-data');
    expect(JSON.stringify(result)).not.toContain('token=secret');
  });

  it('preserves all 64 bounded native failure identities even when none is expected', async () => {
    const attempts = Array.from({ length: 64 }, (_, index) => ({
      ...sessionAttempt('interrupted'),
      attemptId: `actual-attempt-${index}`,
      conversationId: `actual-conversation-${index}`,
    }));
    const harness = makeHarness({
      nativeRun: vi.fn(async () =>
        err({
          type: 'native-browser-cleanup-failed',
          message: 'Native browser cleanup could not prove quiescence.',
          quiescent: false,
          recoveryRequired: true,
          sessionAttempts: attempts,
        })
      ),
    });

    const result = await harness.adapter.run(input());

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'native-browser-cleanup-failed',
        quiescent: false,
        recoveryRequired: true,
      },
    });
    if (result.success) throw new Error('Expected native recovery authority.');
    expect(result.error.sessionAttempts).toEqual(attempts);
    expect(result.error.sessionAttempts).toHaveLength(64);
    expect(result.error.sessionAttempts).not.toContainEqual(
      expect.objectContaining({ attemptId: 'browser-attempt-1' })
    );
  });

  it('marks 65 reported native identities invalid and retains the bounded recovery set', async () => {
    const attempts = Array.from({ length: 65 }, (_, index) => ({
      ...sessionAttempt('interrupted'),
      attemptId: `overbound-attempt-${index}`,
      conversationId: `overbound-conversation-${index}`,
    }));
    const harness = makeHarness({
      nativeRun: vi.fn(async () =>
        err({
          type: 'native-browser-cleanup-failed',
          message: 'Native browser returned too many recovery identities.',
          quiescent: true,
          recoveryRequired: false,
          sessionAttempts: attempts,
        })
      ),
    });

    const result = await harness.adapter.run(input());

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'native-browser-authority-invalid',
        quiescent: false,
        recoveryRequired: true,
      },
    });
    if (result.success) throw new Error('Expected invalid native recovery authority.');
    expect(result.error.sessionAttempts).toEqual(attempts.slice(0, 64));
    expect(result.error.sessionAttempts).toHaveLength(64);
  });

  it('forces recovery for a malformed bounded native failure list without losing valid entries', async () => {
    const valid = {
      ...sessionAttempt('interrupted'),
      attemptId: 'valid-actual-attempt',
      conversationId: 'valid-actual-conversation',
    };
    const malformed = {
      ...sessionAttempt('interrupted'),
      attemptId: 'alien-attempt',
      conversationId: 'alien-conversation',
      phaseId: 'alien-phase',
    };
    const harness = makeHarness({
      nativeRun: vi.fn(async () =>
        err({
          type: 'native-browser-rejected',
          message: 'Native browser returned drifted session authority.',
          quiescent: true,
          recoveryRequired: false,
          sessionAttempts: [valid, malformed],
        })
      ),
    });

    const result = await harness.adapter.run(input());

    expect(result).toEqual(
      err({
        type: 'native-browser-authority-invalid',
        message: 'Native browser verification returned inconsistent recovery authority.',
        quiescent: false,
        recoveryRequired: true,
        sessionAttempts: [valid],
      })
    );
  });

  it('maps a thrown native operation to explicit recovery instead of rejecting', async () => {
    const harness = makeHarness({
      nativeRun: vi.fn(async () => Promise.reject(new Error('native threw'))),
    });

    const result = await harness.adapter.run(input());

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'native-browser-execution-error',
        quiescent: false,
        recoveryRequired: true,
      },
    });
  });

  it('maps hostile native settlement getters to explicit recovery', async () => {
    const harness = makeHarness({
      nativeRun: vi.fn(
        async () =>
          new Proxy(
            {},
            {
              get(_target, property) {
                if (property === 'success') throw new Error('hostile getter');
                return undefined;
              },
            }
          ) as never
      ),
    });

    const result = await harness.adapter.run(input());

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'native-browser-authority-invalid',
        quiescent: false,
        recoveryRequired: true,
      },
    });
  });

  it('rejects stale durable verification authority before verifier effects', async () => {
    const harness = makeHarness();
    harness.resolveContext.mockResolvedValueOnce(
      ok({
        loop: {
          ...loop,
          state: { ...loopState, verification: { ...loopState.verification!, attempt: 2 } },
        },
        phase,
      })
    );

    const result = await harness.adapter.run(input());

    expect(result).toMatchObject({
      success: false,
      error: { type: 'required-checks-context-invalid' },
    });
    expect(harness.native.run).not.toHaveBeenCalled();
  });

  it('rejects an expired deadline and oversized aggregate criteria before authority lookup', async () => {
    const expiredHarness = makeHarness();
    const expired = input();
    expired.deadlineAt = Date.now() - 1;

    const expiredResult = await expiredHarness.adapter.run(expired);

    expect(expiredResult).toMatchObject({ success: false, error: { quiescent: true } });
    expect(expiredHarness.resolveContext).not.toHaveBeenCalled();

    const criteriaHarness = makeHarness();
    const oversized = input();
    oversized.criteria = Array.from({ length: 20 }, (_, index) => ({
      description: `criterion-${index}`,
      verifier: 'agent-browser' as const,
      status: 'pending' as const,
      evidence: 'x'.repeat(16_000),
    }));

    const oversizedResult = await criteriaHarness.adapter.run(oversized);

    expect(oversizedResult).toMatchObject({ success: false });
    expect(criteriaHarness.resolveContext).not.toHaveBeenCalled();
  });

  it('aborts validation at the deadline and settles before launching native effects', async () => {
    const harness = makeHarness();
    let validationSignal: AbortSignal | undefined;
    vi.mocked(harness.validationVerifier.run).mockImplementationOnce(
      async (ctx) =>
        await new Promise((resolve) => {
          validationSignal = ctx.signal;
          const settle = () =>
            resolve(
              err({
                kind: 'aborted',
                verifierId: 'unit-tests',
                message: 'Validation stopped.',
                cwd: ctx.cwd,
              })
            );
          ctx.signal?.addEventListener('abort', settle, { once: true });
          if (ctx.signal?.aborted) settle();
        })
    );
    const runInput = input();
    runInput.deadlineAt = Date.now() + 100;
    const startedAt = Date.now();

    const result = await harness.adapter.run(runInput);

    expect(Date.now() - startedAt).toBeLessThan(1_500);
    expect(validationSignal?.aborted).toBe(true);
    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'required-checks-aborted',
        quiescent: true,
        recoveryRequired: false,
      },
    });
    expect(harness.native.run).not.toHaveBeenCalled();
  });

  it('passes the deadline signal to native and retains its quiescent session identity', async () => {
    let nativeSignal: AbortSignal | undefined;
    const harness = makeHarness({
      nativeRun: vi.fn<NativeBrowserE2EAttestationPort['run']>(
        async (nativeInput) =>
          await new Promise<Awaited<ReturnType<NativeBrowserE2EAttestationPort['run']>>>(
            (resolve) => {
              nativeSignal = nativeInput.signal;
              const settle = () => resolve(ok(attestation('passed')));
              nativeInput.signal?.addEventListener('abort', settle, { once: true });
              if (nativeInput.signal?.aborted) settle();
            }
          )
      ),
    });
    const runInput = input();
    runInput.deadlineAt = Date.now() + 100;

    const result = await harness.adapter.run(runInput);

    expect(nativeSignal?.aborted).toBe(true);
    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'required-checks-aborted',
        quiescent: true,
        recoveryRequired: false,
        sessionAttempts: [
          expect.objectContaining({
            attemptId: 'browser-attempt-1',
            conversationId: 'browser-conversation-1',
            status: 'completed',
          }),
        ],
      },
    });
  });

  it('links and disposes the caller abort signal without launching later effects', async () => {
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const harness = makeHarness();
    let derivedSignal: AbortSignal | undefined;
    vi.mocked(harness.validationVerifier.run).mockImplementationOnce(async (ctx) => {
      derivedSignal = ctx.signal;
      controller.abort();
      return err({
        kind: 'aborted',
        verifierId: 'unit-tests',
        message: 'Caller stopped validation.',
        cwd: ctx.cwd,
      });
    });
    const runInput = input();
    runInput.signal = controller.signal;

    const result = await harness.adapter.run(runInput);

    expect(derivedSignal).toBeInstanceOf(AbortSignal);
    expect(derivedSignal).not.toBe(controller.signal);
    expect(derivedSignal?.aborted).toBe(true);
    expect(result).toMatchObject({ success: false, error: { quiescent: true } });
    expect(harness.native.run).not.toHaveBeenCalled();
    expect(addListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('snapshots stateful request and durable-context getters exactly once', async () => {
    const harness = makeHarness();
    const runInput = input();
    let requestModelReads = 0;
    Object.defineProperty(runInput, 'model', {
      configurable: true,
      get() {
        requestModelReads += 1;
        return requestModelReads === 1 ? 'gpt-5.6-sol' : 'drifted-model';
      },
    });
    const rawConfig = { ...loop.config };
    let contextModelReads = 0;
    Object.defineProperty(rawConfig, 'model', {
      configurable: true,
      enumerable: true,
      get() {
        contextModelReads += 1;
        return contextModelReads === 1 ? 'gpt-5.6-sol' : ' padded-model ';
      },
    });
    harness.resolveContext.mockResolvedValueOnce(
      ok({ loop: { ...loop, config: rawConfig as Loop['config'] }, phase })
    );

    const result = await harness.adapter.run(runInput);

    expect(result).toMatchObject({ success: true, data: { model: 'gpt-5.6-sol' } });
    expect(requestModelReads).toBe(1);
    expect(contextModelReads).toBe(1);
    expect(harness.native.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.6-sol' })
    );
  });

  it.each([
    [
      'a padded durable model',
      { loop: { ...loop, config: { ...loop.config!, model: ' gpt-5.6-sol ' } }, phase },
    ],
    [
      'an extra durable config key',
      { loop: { ...loop, config: { ...loop.config!, unexpected: true } as never }, phase },
    ],
    [
      'an extra durable criterion key',
      {
        loop,
        phase: {
          ...phase,
          criteria: {
            version: '1' as const,
            criteria: [{ ...criteria[0]!, unexpected: true } as never],
          },
        },
      },
    ],
  ])('rejects raw-canonical drift from %s before effects', async (_label, context) => {
    const harness = makeHarness();
    harness.resolveContext.mockResolvedValueOnce(ok(context as never));

    const result = await harness.adapter.run(input());

    expect(result).toMatchObject({
      success: false,
      error: { type: 'required-checks-context-invalid' },
    });
    expect(harness.validationVerifier.run).not.toHaveBeenCalled();
    expect(harness.native.run).not.toHaveBeenCalled();
  });

  it.each(['relative/loop-verify-1', '/tmp/loop/../loop-verify-1'])(
    'rejects a relative or noncanonical target path %s before authority lookup',
    async (targetPath) => {
      const harness = makeHarness();
      const runInput = input();
      const driftedTarget = { ...target, path: targetPath };
      const driftedEnvironment = Object.freeze({
        ...taskEnvironment,
        EMDASH_TASK_PATH: targetPath,
      });
      runInput.target = driftedTarget;
      runInput.executionTarget = {
        ...executionTarget(),
        ...driftedTarget,
        taskEnv: driftedEnvironment,
      };
      runInput.taskEnvironment = driftedEnvironment;

      const result = await harness.adapter.run(runInput);

      expect(result).toMatchObject({
        success: false,
        error: { type: 'required-checks-context-invalid' },
      });
      expect(harness.resolveContext).not.toHaveBeenCalled();
      expect(harness.validationVerifier.run).not.toHaveBeenCalled();
      expect(harness.native.run).not.toHaveBeenCalled();
    }
  );

  it.each(['image/png; token=secret', 'image//private/app-data/secret', 'text/plain'])(
    'rejects unsafe or unapproved screenshot MIME metadata %s',
    async (mimeType) => {
      const raw = attestation('passed');
      const harness = makeHarness({
        nativeRun: vi.fn(async () =>
          ok({
            ...raw,
            evidence: {
              ...raw.evidence,
              artifacts: [{ ...raw.evidence.artifacts[0]!, mimeType }],
            },
          } as never)
        ),
      });

      const result = await harness.adapter.run(input());

      expect(result).toMatchObject({
        success: false,
        error: { type: 'native-browser-authority-invalid' },
      });
      expect(JSON.stringify(result)).not.toContain('token=secret');
      expect(JSON.stringify(result)).not.toContain('/private/app-data');
    }
  );

  it('redacts absolute validation paths from returned summaries', async () => {
    const harness = makeHarness();
    vi.mocked(harness.validationVerifier.run).mockResolvedValueOnce(
      ok({
        verifierId: 'unit-tests',
        label: 'Unit tests',
        command: 'pnpm run test',
        cwd: target.path,
        durationMs: 1,
        stdoutTail: '',
        stderrTail: '',
        exitCode: 0,
        summary: 'Passed; evidence at /private/app-data/loops/evidence/run.',
      })
    );

    const result = await harness.adapter.run(input());

    expect(result).toMatchObject({ success: true });
    expect(JSON.stringify(result)).not.toContain('/private/app-data');
  });

  it('rejects path-bearing artifact identifiers instead of persisting them', async () => {
    const raw = attestation('passed');
    const harness = makeHarness({
      nativeRun: vi.fn(async () =>
        ok({
          ...raw,
          evidence: {
            ...raw.evidence,
            artifacts: [
              { ...raw.evidence.artifacts[0]!, artifactId: '/private/app-data/secret.png' },
            ],
          },
        } as never)
      ),
    });

    const result = await harness.adapter.run(input());

    expect(result).toMatchObject({
      success: false,
      error: { type: 'native-browser-authority-invalid' },
    });
    expect(JSON.stringify(result)).not.toContain('/private/app-data');
  });
});
