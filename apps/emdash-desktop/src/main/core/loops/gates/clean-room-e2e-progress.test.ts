import { describe, expect, it } from 'vitest';
import type { LoopPhaseRetryHandoff } from '@shared/core/loops/loop-phase-state';
import type {
  LoopSessionAttempt,
  LoopSessionTarget,
  LoopVerificationWorkspaceState,
} from '@shared/core/loops/loop-state';
import { CLEAN_ROOM_E2E_MAX_ATTEMPTS } from '@shared/core/loops/loop-state';
import {
  copyE2EDurableProgress,
  reduceE2EProgress,
  type E2EDurableProgress,
} from './clean-room-e2e-progress';

const BASE = 'a'.repeat(40);
const CHECKPOINT = 'b'.repeat(40);
const CORRECTION = 'c'.repeat(40);
const NOW = '2026-07-12T20:00:00.000Z';

const target: LoopSessionTarget = {
  workspaceId: 'verification-workspace-1',
  path: '/tmp/verification-workspace-1',
  machine: { kind: 'local' },
};

const retryHandoff: LoopPhaseRetryHandoff = {
  source: 'Clean-room E2E attempt 1',
  handoff: {
    summary: 'The required check found a retryable defect.',
    risks: ['The correction still needs an independent replay.'],
    remainingWork: ['Recreate the clean room and rerun the checks.'],
    artifacts: [],
    createdAt: NOW,
  },
};

function baseProgress(): E2EDurableProgress {
  return {
    loopState: {
      version: '1',
      baseCommit: BASE,
      expectedFeatureHead: CHECKPOINT,
      checkpointCommit: CHECKPOINT,
      sessionAttempts: [],
      verification: null,
    },
    phaseState: null,
  };
}

function workspace(
  status: LoopVerificationWorkspaceState['status'],
  overrides: Partial<LoopVerificationWorkspaceState> = {}
): LoopVerificationWorkspaceState {
  const hasTarget = status !== 'preparing';
  return {
    verificationRunId: 'verification-run-1',
    attempt: 1,
    status,
    ...(hasTarget ? { target, replayedThroughCommit: CHECKPOINT } : {}),
    baseCommit: BASE,
    expectedFeatureHead: CHECKPOINT,
    cleanup: {
      status:
        status === 'destroying' ? 'running' : status === 'cleanup-failed' ? 'failed' : 'pending',
      updatedAt: NOW,
      ...(status === 'cleanup-failed' ? { error: 'Cleanup failed.' } : {}),
    },
    ...overrides,
  };
}

function runningAttempt(overrides: Partial<LoopSessionAttempt> = {}): LoopSessionAttempt {
  return {
    attemptId: 'e2e-attempt-1',
    conversationId: 'e2e-conversation-1',
    purpose: 'e2e',
    phaseId: 'phase-e2e',
    verificationRunId: 'verification-run-1',
    target,
    status: 'running',
    checkpointBefore: CHECKPOINT,
    startedAt: NOW,
    ...overrides,
  };
}

function startingAttempt(overrides: Partial<LoopSessionAttempt> = {}): LoopSessionAttempt {
  return runningAttempt({ status: 'starting', ...overrides });
}

function unwrap(progress: ReturnType<typeof reduceE2EProgress>): E2EDurableProgress {
  expect(progress.success).toBe(true);
  if (!progress.success) throw new Error(progress.error.message);
  return progress.data;
}

function activeProgress(): E2EDurableProgress {
  let progress = baseProgress();
  progress = unwrap(
    reduceE2EProgress(progress, { kind: 'workspace', verification: workspace('preparing') })
  );
  progress = unwrap(
    reduceE2EProgress(progress, { kind: 'workspace', verification: workspace('ready') })
  );
  progress = unwrap(
    reduceE2EProgress(progress, { kind: 'workspace', verification: workspace('running') })
  );
  progress = unwrap(
    reduceE2EProgress(progress, { kind: 'session-attempt', next: startingAttempt() })
  );
  progress = unwrap(
    reduceE2EProgress(progress, {
      kind: 'session-attempt',
      previous: startingAttempt(),
      next: runningAttempt(),
    })
  );
  return unwrap(
    reduceE2EProgress(progress, {
      kind: 'workspace',
      verification: workspace('integrating-fix', { replayedThroughCommit: CORRECTION }),
    })
  );
}

describe('clean-room E2E durable progress reducer', () => {
  it('copies the optional persisted budget exactly without normalizing aliases', () => {
    const durable = baseProgress();
    durable.loopState.e2eAttemptsConsumed = 2;

    expect(copyE2EDurableProgress(durable).loopState.e2eAttemptsConsumed).toBe(2);
    expect(() =>
      copyE2EDurableProgress({
        ...durable,
        loopState: {
          ...durable.loopState,
          e2eAttemptsConsumed: '2' as unknown as number,
        },
      })
    ).toThrow();
  });

  it('charges the fixed durable budget before any session can start and retains it after cleanup', () => {
    const preparing = unwrap(
      reduceE2EProgress(baseProgress(), {
        kind: 'workspace',
        verification: workspace('preparing'),
      })
    );

    expect(preparing.loopState.e2eAttemptsConsumed).toBe(1);
    expect(preparing.loopState.sessionAttempts).toEqual([]);

    const cleared = unwrap(
      reduceE2EProgress(preparing, {
        kind: 'workspace',
        verification: null,
      })
    );
    expect(cleared.loopState.e2eAttemptsConsumed).toBe(1);
    expect(cleared.loopState.verification).toBeNull();

    const second = unwrap(
      reduceE2EProgress(cleared, {
        kind: 'workspace',
        verification: workspace('preparing', {
          verificationRunId: 'verification-run-2',
          attempt: 2,
        }),
      })
    );
    expect(second.loopState.e2eAttemptsConsumed).toBe(2);
  });

  it('cannot raise or bypass the fixed budget after restart', () => {
    const exhausted = baseProgress();
    exhausted.loopState.e2eAttemptsConsumed = CLEAN_ROOM_E2E_MAX_ATTEMPTS;

    expect(
      reduceE2EProgress(exhausted, {
        kind: 'workspace',
        verification: workspace('preparing', {
          verificationRunId: 'verification-run-4',
          attempt: CLEAN_ROOM_E2E_MAX_ATTEMPTS + 1,
        }),
      }).success
    ).toBe(false);
  });

  it('materializes historical outer-run consumption before charging the next workspace', () => {
    const historical = baseProgress();
    historical.loopState.sessionAttempts = [
      runningAttempt({
        status: 'failed',
        finishedAt: NOW,
        error: 'Historical E2E attempt failed.',
      }),
    ];

    const next = unwrap(
      reduceE2EProgress(historical, {
        kind: 'workspace',
        verification: workspace('preparing', {
          verificationRunId: 'verification-run-2',
          attempt: 2,
        }),
      })
    );
    expect(next.loopState.e2eAttemptsConsumed).toBe(2);
  });

  it('atomically advances Loop and phase checkpoints, the attempt, and retained handoffs', () => {
    const completed = runningAttempt({
      status: 'completed',
      checkpointAfter: CORRECTION,
      finishedAt: '2026-07-12T20:05:00.000Z',
    });

    const reduced = unwrap(
      reduceE2EProgress(activeProgress(), {
        kind: 'checkpoint-advanced',
        previousHead: CHECKPOINT,
        featureHead: CORRECTION,
        completedAttempt: completed,
        retryHandoffs: [retryHandoff],
      })
    );

    expect(reduced.loopState).toMatchObject({
      expectedFeatureHead: CORRECTION,
      checkpointCommit: CORRECTION,
      verification: { expectedFeatureHead: CORRECTION },
      sessionAttempts: [completed],
    });
    expect(reduced.phaseState).toEqual({
      version: '2',
      checkpointCommit: CORRECTION,
      handoff: null,
      retryHandoffs: [retryHandoff],
      result: null,
    });
  });

  it('persists exactly one retry handoff without mutating Loop state', () => {
    const expected = baseProgress();
    const first = unwrap(
      reduceE2EProgress(expected, {
        kind: 'retry-handoffs',
        checkpointCommit: CHECKPOINT,
        retryHandoffs: [retryHandoff],
      })
    );
    const secondHandoff = {
      ...retryHandoff,
      source: 'Clean-room E2E attempt 2',
    };
    const second = unwrap(
      reduceE2EProgress(first, {
        kind: 'retry-handoffs',
        checkpointCommit: CHECKPOINT,
        retryHandoffs: [retryHandoff, secondHandoff],
      })
    );

    expect(second.loopState).toEqual(copyE2EDurableProgress(expected).loopState);
    expect(second.phaseState?.checkpointCommit).toBe(CHECKPOINT);
    expect(second.phaseState?.retryHandoffs).toEqual([retryHandoff, secondHandoff]);
    expect(
      reduceE2EProgress(second, {
        kind: 'retry-handoffs',
        checkpointCommit: CHECKPOINT,
        retryHandoffs: [secondHandoff],
      }).success
    ).toBe(false);
    expect(
      reduceE2EProgress(first, {
        kind: 'retry-handoffs',
        checkpointCommit: CHECKPOINT,
        retryHandoffs: [secondHandoff, retryHandoff],
      }).success
    ).toBe(false);
  });

  it('rejects cross-run workspace replacement and invalid lifecycle transitions', () => {
    const preparing = unwrap(
      reduceE2EProgress(baseProgress(), {
        kind: 'workspace',
        verification: workspace('preparing'),
      })
    );

    expect(
      reduceE2EProgress(preparing, {
        kind: 'workspace',
        verification: workspace('ready', { verificationRunId: 'verification-run-2' }),
      }).success
    ).toBe(false);
    expect(
      reduceE2EProgress(preparing, {
        kind: 'workspace',
        verification: workspace('running'),
      }).success
    ).toBe(false);
    expect(
      reduceE2EProgress(baseProgress(), {
        kind: 'workspace',
        verification: workspace('ready'),
      }).success
    ).toBe(false);
  });

  it('changes replay authority only from running to integrating-fix and preserves it thereafter', () => {
    let progress = baseProgress();
    for (const status of ['preparing', 'ready', 'running'] as const) {
      progress = unwrap(
        reduceE2EProgress(progress, { kind: 'workspace', verification: workspace(status) })
      );
    }

    expect(
      reduceE2EProgress(progress, {
        kind: 'workspace',
        verification: workspace('running', { replayedThroughCommit: CORRECTION }),
      }).success
    ).toBe(false);
    expect(
      reduceE2EProgress(progress, {
        kind: 'workspace',
        verification: workspace('integrating-fix'),
      }).success
    ).toBe(false);

    const integrating = unwrap(
      reduceE2EProgress(progress, {
        kind: 'workspace',
        verification: workspace('integrating-fix', { replayedThroughCommit: CORRECTION }),
      })
    );
    expect(integrating.loopState.verification?.replayedThroughCommit).toBe(CORRECTION);
    expect(
      reduceE2EProgress(integrating, {
        kind: 'workspace',
        verification: workspace('destroying'),
      }).success
    ).toBe(false);
    expect(
      reduceE2EProgress(integrating, {
        kind: 'workspace',
        verification: workspace('destroying', { replayedThroughCommit: CORRECTION }),
      }).success
    ).toBe(true);
  });

  it('allows only the controlled same-run cleanup path to clear workspace authority', () => {
    let progress = baseProgress();
    progress = unwrap(
      reduceE2EProgress(progress, {
        kind: 'workspace',
        verification: workspace('preparing'),
      })
    );
    progress = unwrap(
      reduceE2EProgress(progress, { kind: 'workspace', verification: workspace('ready') })
    );
    progress = unwrap(
      reduceE2EProgress(progress, {
        kind: 'workspace',
        verification: workspace('destroying'),
      })
    );
    progress = unwrap(reduceE2EProgress(progress, { kind: 'workspace', verification: null }));

    expect(progress.loopState.verification).toBeNull();
    expect(
      reduceE2EProgress(
        {
          ...baseProgress(),
          loopState: { ...baseProgress().loopState, verification: workspace('running') },
        },
        { kind: 'workspace', verification: null }
      ).success
    ).toBe(false);
  });

  it('rejects stale session replacement and checkpoint attempt authority', () => {
    const running = unwrap(
      reduceE2EProgress(baseProgress(), {
        kind: 'session-attempt',
        next: startingAttempt(),
      })
    );
    const started = unwrap(
      reduceE2EProgress(running, {
        kind: 'session-attempt',
        previous: startingAttempt(),
        next: runningAttempt(),
      })
    );
    expect(
      reduceE2EProgress(started, {
        kind: 'session-attempt',
        previous: runningAttempt({ startedAt: '2026-07-12T19:00:00.000Z' }),
        next: runningAttempt({ status: 'failed', finishedAt: NOW }),
      }).success
    ).toBe(false);

    const active = activeProgress();
    expect(
      reduceE2EProgress(active, {
        kind: 'checkpoint-advanced',
        previousHead: CHECKPOINT,
        featureHead: CORRECTION,
        completedAttempt: runningAttempt({
          status: 'completed',
          checkpointAfter: CORRECTION,
          finishedAt: NOW,
          startedAt: '2026-07-12T19:00:00.000Z',
        }),
        retryHandoffs: [retryHandoff],
      }).success
    ).toBe(false);
  });

  it('appends only an exact canonical starting attempt', () => {
    expect(
      reduceE2EProgress(baseProgress(), {
        kind: 'session-attempt',
        next: runningAttempt(),
      }).success
    ).toBe(false);
    expect(
      reduceE2EProgress(baseProgress(), {
        kind: 'session-attempt',
        next: startingAttempt({ attemptId: ' e2e-attempt-1' }),
      }).success
    ).toBe(false);
    expect(
      reduceE2EProgress(baseProgress(), {
        kind: 'session-attempt',
        next: startingAttempt({ target: { ...target, path: ` ${target.path}` } }),
      }).success
    ).toBe(false);
    expect(
      reduceE2EProgress(baseProgress(), {
        kind: 'session-attempt',
        next: startingAttempt({ startedAt: '2026-07-12T20:00:00Z' }),
      }).success
    ).toBe(false);
    expect(
      reduceE2EProgress(baseProgress(), {
        kind: 'session-attempt',
        next: startingAttempt({ finishedAt: NOW }),
      }).success
    ).toBe(false);
  });

  it('requires strict status fields and chronological attempt replacement', () => {
    const starting = unwrap(
      reduceE2EProgress(baseProgress(), {
        kind: 'session-attempt',
        next: startingAttempt(),
      })
    );
    const invalidReplacements = [
      runningAttempt({ status: 'completed', finishedAt: NOW }),
      runningAttempt({
        status: 'completed',
        checkpointAfter: CHECKPOINT,
        finishedAt: NOW,
        error: 'A completed attempt cannot retain an error.',
      }),
      runningAttempt({
        status: 'failed',
        checkpointAfter: CHECKPOINT,
        finishedAt: NOW,
        error: 'Failed.',
      }),
      runningAttempt({ status: 'failed', finishedAt: NOW }),
      runningAttempt({ status: 'failed', finishedAt: NOW, error: ' Failed. ' }),
      runningAttempt({
        status: 'failed',
        startedAt: '2026-07-12T20:05:00.000Z',
        finishedAt: NOW,
        error: 'Finished before it started.',
      }),
    ];

    for (const next of invalidReplacements) {
      expect(
        reduceE2EProgress(starting, {
          kind: 'session-attempt',
          previous: startingAttempt(),
          next,
        }).success
      ).toBe(false);
    }
  });

  it('cannot advance a checkpoint by appending an absent completed attempt', () => {
    const activeWithoutAttempt = activeProgress();
    activeWithoutAttempt.loopState.sessionAttempts = [];

    expect(
      reduceE2EProgress(activeWithoutAttempt, {
        kind: 'checkpoint-advanced',
        previousHead: CHECKPOINT,
        featureHead: CORRECTION,
        completedAttempt: runningAttempt({
          status: 'completed',
          checkpointAfter: CORRECTION,
          finishedAt: '2026-07-12T20:05:00.000Z',
        }),
        retryHandoffs: [retryHandoff],
      }).success
    ).toBe(false);
  });

  it('rejects inconsistent phase checkpoints and retry handoff rollback', () => {
    const inconsistent: E2EDurableProgress = {
      ...baseProgress(),
      phaseState: {
        version: '2',
        checkpointCommit: BASE,
        handoff: null,
        retryHandoffs: [],
        result: null,
      },
    };
    expect(
      reduceE2EProgress(inconsistent, {
        kind: 'session-attempt',
        next: runningAttempt(),
      }).success
    ).toBe(false);

    const withHandoff = unwrap(
      reduceE2EProgress(baseProgress(), {
        kind: 'retry-handoffs',
        checkpointCommit: CHECKPOINT,
        retryHandoffs: [retryHandoff],
      })
    );
    const active = activeProgress();
    const activeWithHandoff: E2EDurableProgress = {
      ...active,
      phaseState: withHandoff.phaseState,
    };
    expect(
      reduceE2EProgress(activeWithHandoff, {
        kind: 'checkpoint-advanced',
        previousHead: CHECKPOINT,
        featureHead: CORRECTION,
        completedAttempt: runningAttempt({
          status: 'completed',
          checkpointAfter: CORRECTION,
          finishedAt: NOW,
        }),
        retryHandoffs: [],
      }).success
    ).toBe(false);
  });

  it('does not overwrite a terminal result or restart its workspace', () => {
    const terminal = unwrap(
      reduceE2EProgress(baseProgress(), {
        kind: 'terminal',
        checkpointCommit: CHECKPOINT,
        handoff: null,
        result: { status: 'passed', summary: 'Passed.', completedAt: NOW },
      })
    );

    expect(
      reduceE2EProgress(terminal, {
        kind: 'terminal',
        checkpointCommit: CHECKPOINT,
        handoff: null,
        result: { status: 'failed', summary: 'Replaced.', completedAt: NOW },
      }).success
    ).toBe(false);
    expect(
      reduceE2EProgress(terminal, {
        kind: 'workspace',
        verification: workspace('preparing'),
      }).success
    ).toBe(false);
  });

  it('terminalizes only after workspace and every session are quiescent', () => {
    const starting = unwrap(
      reduceE2EProgress(baseProgress(), {
        kind: 'session-attempt',
        next: startingAttempt(),
      })
    );
    expect(
      reduceE2EProgress(starting, {
        kind: 'terminal',
        checkpointCommit: CHECKPOINT,
        handoff: null,
        result: { status: 'failed', summary: 'Failed.', completedAt: NOW },
      }).success
    ).toBe(false);

    const preparing = unwrap(
      reduceE2EProgress(baseProgress(), {
        kind: 'workspace',
        verification: workspace('preparing'),
      })
    );
    expect(
      reduceE2EProgress(preparing, {
        kind: 'terminal',
        checkpointCommit: CHECKPOINT,
        handoff: null,
        result: { status: 'failed', summary: 'Failed.', completedAt: NOW },
      }).success
    ).toBe(false);
  });
});
