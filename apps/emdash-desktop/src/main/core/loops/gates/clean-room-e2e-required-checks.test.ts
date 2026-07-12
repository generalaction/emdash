import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@main/lib/result';
import type { LoopPhaseState } from '@shared/core/loops/loop-phase-state';
import type {
  LoopSessionAttempt,
  LoopSessionTarget,
  LoopState,
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
const loopState: LoopState = {
  version: '1',
  baseCommit: BASE_COMMIT,
  expectedFeatureHead: CHECKPOINT_COMMIT,
  checkpointCommit: CHECKPOINT_COMMIT,
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
  const resolveContext = vi.fn(async () => ok({ loop, phase }));
  const adapter = new CleanRoomE2ERequiredChecksAdapter({
    resolveContext,
    validationVerifier,
    native,
    now: () => new Date('2026-07-12T01:02:03.000Z'),
  });
  return { adapter, native, resolveContext, validationVerifier };
}

describe('CleanRoomE2ERequiredChecksAdapter', () => {
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
          executionTarget: runInput.executionTarget,
          validationCommands,
          criteria,
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
        })
      );
    }
  );

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
