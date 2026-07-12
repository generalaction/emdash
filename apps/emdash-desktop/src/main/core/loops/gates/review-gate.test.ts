import { describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '@main/lib/result';
import type { LoopSessionTarget } from '@shared/core/loops/loop-state';
import {
  TerminalReviewGate,
  type ReviewCheckpointRangeValidation,
  type ReviewCorrectionValidation,
  type ReviewGateDependencies,
  type ReviewGateDependencyError,
  type ReviewRequiredGateResult,
  type ReviewSessionCancellation,
  type ReviewSessionInfo,
  type ReviewWorkspaceSnapshot,
  type RunTerminalReviewGateInput,
} from './review-gate';

const BASE_COMMIT = '1'.repeat(40);
const CHECKPOINT_COMMIT = '2'.repeat(40);
const CORRECTION_COMMIT = '3'.repeat(40);
const OTHER_COMMIT = '4'.repeat(40);

const localTarget: LoopSessionTarget = {
  workspaceId: 'workspace-local',
  path: '/tmp/emdash-loop',
  machine: { kind: 'local' },
};

const sshTarget: LoopSessionTarget = {
  workspaceId: 'workspace-ssh',
  path: '/srv/emdash-loop',
  machine: { kind: 'ssh', connectionId: 'ssh-production' },
};

const passedWorkResult = {
  status: 'passed' as const,
  summary: 'Work phase passed.',
  completedAt: '2026-07-12T00:00:00.000Z',
};

const defaultInput: RunTerminalReviewGateInput = {
  goal: 'Finish ACP Loops v2 safely.',
  acceptanceCriteria: ['The terminal Review gate passes.'],
  baseCommit: BASE_COMMIT,
  checkpointCommit: CHECKPOINT_COMMIT,
  handoffs: [],
  target: localTarget,
  provider: 'codex',
  model: 'gpt-5.6-sol',
  workPhaseResults: [passedWorkResult],
  previousConversationIds: ['work-conversation'],
};

type HarnessOptions = {
  target?: LoopSessionTarget;
  sessionTarget?: LoopSessionTarget;
  conversationId?: string;
  finalText?: string;
  snapshots?: ReviewWorkspaceSnapshot[];
  rangeValidation?: ReviewCheckpointRangeValidation;
  correctionValidation?: ReviewCorrectionValidation;
  requiredGateResult?: ReviewRequiredGateResult;
  inspectFailure?: ReviewGateDependencyError;
  rangeFailure?: ReviewGateDependencyError;
  startFailure?: ReviewGateDependencyError;
  promptFailure?: ReviewGateDependencyError;
  correctionFailure?: ReviewGateDependencyError;
  requiredGateFailure?: ReviewGateDependencyError;
  cancellationFailure?: ReviewGateDependencyError;
  cancellationResult?: ReviewSessionCancellation;
};

function snapshot(
  target: LoopSessionTarget,
  headCommit = CHECKPOINT_COMMIT,
  clean = true
): ReviewWorkspaceSnapshot {
  return { target, headCommit, clean };
}

function rangeValidation(
  target: LoopSessionTarget,
  overrides: Partial<ReviewCheckpointRangeValidation> = {}
): ReviewCheckpointRangeValidation {
  return {
    target,
    baseCommit: BASE_COMMIT,
    checkpointCommit: CHECKPOINT_COMMIT,
    linear: true,
    loopOwned: true,
    ...overrides,
  };
}

function correctionValidation(
  target: LoopSessionTarget,
  overrides: Partial<ReviewCorrectionValidation> = {}
): ReviewCorrectionValidation {
  return {
    target,
    baseCommit: BASE_COMMIT,
    previousCheckpointCommit: CHECKPOINT_COMMIT,
    checkpointCommit: CORRECTION_COMMIT,
    parentCommit: CHECKPOINT_COMMIT,
    commitCount: 1,
    linear: true,
    loopOwned: true,
    ...overrides,
  };
}

function makeHarness(options: HarnessOptions = {}): {
  gate: TerminalReviewGate;
  dependencies: ReviewGateDependencies;
} {
  const target = options.target ?? localTarget;
  const snapshots = options.snapshots ?? [snapshot(target), snapshot(target), snapshot(target)];
  let inspectIndex = 0;

  const inspectWorkspace = vi.fn(
    async (): Promise<Result<ReviewWorkspaceSnapshot, ReviewGateDependencyError>> => {
      if (options.inspectFailure) return err(options.inspectFailure);
      const value = snapshots[Math.min(inspectIndex, snapshots.length - 1)];
      inspectIndex += 1;
      return ok(value ?? snapshot(target));
    }
  );
  const validateCheckpointRange = vi.fn(
    async (): Promise<Result<ReviewCheckpointRangeValidation, ReviewGateDependencyError>> =>
      options.rangeFailure
        ? err(options.rangeFailure)
        : ok(options.rangeValidation ?? rangeValidation(target))
  );
  const validateCorrection = vi.fn(
    async (): Promise<Result<ReviewCorrectionValidation, ReviewGateDependencyError>> =>
      options.correctionFailure
        ? err(options.correctionFailure)
        : ok(options.correctionValidation ?? correctionValidation(target))
  );
  const startFreshReviewSession = vi.fn(
    async (): Promise<Result<ReviewSessionInfo, ReviewGateDependencyError>> =>
      options.startFailure
        ? err(options.startFailure)
        : ok({
            conversationId: options.conversationId ?? 'fresh-review-conversation',
            target: options.sessionTarget ?? target,
          })
  );
  const sendReviewPrompt = vi.fn(
    async (): Promise<Result<{ finalText: string }, ReviewGateDependencyError>> =>
      options.promptFailure
        ? err(options.promptFailure)
        : ok({
            finalText: options.finalText ?? 'Review passed.\n<<<LOOP:REVIEW_PASSED>>>',
          })
  );
  const cancelReviewSession = vi.fn(
    async (input: {
      conversationId: string;
      target: LoopSessionTarget;
    }): Promise<Result<ReviewSessionCancellation, ReviewGateDependencyError>> =>
      options.cancellationFailure
        ? err(options.cancellationFailure)
        : ok(
            options.cancellationResult ?? {
              conversationId: input.conversationId,
              target: input.target,
              quiescent: true,
            }
          )
  );
  const runRequiredGate = vi.fn(
    async (): Promise<Result<ReviewRequiredGateResult, ReviewGateDependencyError>> =>
      options.requiredGateFailure
        ? err(options.requiredGateFailure)
        : ok(
            options.requiredGateResult ?? {
              target,
              checkpointCommit: CHECKPOINT_COMMIT,
              summary: 'Required gate passed.',
            }
          )
  );

  const dependencies: ReviewGateDependencies = {
    session: {
      startFreshReviewSession,
      sendReviewPrompt,
      cancelReviewSession,
    },
    checkpoint: {
      inspectWorkspace,
      validateCheckpointRange,
      validateCorrection,
    },
    requiredGate: { run: runRequiredGate },
    now: () => new Date('2026-07-12T01:02:03.000Z'),
  };

  return { gate: new TerminalReviewGate(dependencies), dependencies };
}

function dependencyError(message = 'dependency rejected'): ReviewGateDependencyError {
  return { type: 'rejected', message };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}

function settlementTracker<T>(promise: Promise<T>): () => boolean {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  return () => settled;
}

describe('TerminalReviewGate', () => {
  it('starts one fresh local Review session over the complete range and reruns the gate', async () => {
    const { gate, dependencies } = makeHarness();

    const result = await gate.run(defaultInput);

    expect(result).toEqual(
      ok({
        purpose: 'review',
        conversationId: 'fresh-review-conversation',
        target: localTarget,
        previousCheckpointCommit: CHECKPOINT_COMMIT,
        checkpointCommit: CHECKPOINT_COMMIT,
        correctionApplied: false,
        requiredGateSummary: 'Required gate passed.',
        stageResult: {
          status: 'passed',
          summary: 'Terminal Review and required gate passed without a correction checkpoint.',
          completedAt: '2026-07-12T01:02:03.000Z',
        },
      })
    );
    expect(dependencies.session.startFreshReviewSession).toHaveBeenCalledTimes(1);
    expect(dependencies.session.startFreshReviewSession).toHaveBeenCalledWith({
      purpose: 'review',
      target: localTarget,
      provider: 'codex',
      model: 'gpt-5.6-sol',
      baseCommit: BASE_COMMIT,
      checkpointCommit: CHECKPOINT_COMMIT,
      signal: undefined,
      deadlineAt: undefined,
    });
    expect(dependencies.session.sendReviewPrompt).toHaveBeenCalledTimes(1);
    expect(dependencies.session.sendReviewPrompt).toHaveBeenCalledWith({
      conversationId: 'fresh-review-conversation',
      target: localTarget,
      signal: undefined,
      deadlineAt: undefined,
      prompt: expect.stringContaining(`"baseCommit":"${BASE_COMMIT}"`),
    });
    const prompt = vi.mocked(dependencies.session.sendReviewPrompt).mock.calls[0]?.[0].prompt;
    expect(prompt).toContain(`"checkpointCommit":"${CHECKPOINT_COMMIT}"`);
    expect(prompt).toContain('Never push, deploy, release, publish, or open a pull request.');
    expect(dependencies.checkpoint.inspectWorkspace).toHaveBeenCalledTimes(3);
    expect(dependencies.checkpoint.validateCheckpointRange).toHaveBeenCalledTimes(1);
    expect(dependencies.checkpoint.validateCorrection).not.toHaveBeenCalled();
    expect(dependencies.requiredGate.run).toHaveBeenCalledWith({
      target: localTarget,
      baseCommit: BASE_COMMIT,
      checkpointCommit: CHECKPOINT_COMMIT,
      signal: undefined,
      deadlineAt: undefined,
    });
  });

  it('keeps the complete SSH identity explicit through every dependency', async () => {
    const { gate, dependencies } = makeHarness({ target: sshTarget });

    const result = await gate.run({ ...defaultInput, target: sshTarget });

    expect(result.success).toBe(true);
    expect(dependencies.session.startFreshReviewSession).toHaveBeenCalledWith(
      expect.objectContaining({ target: sshTarget })
    );
    for (const call of vi.mocked(dependencies.checkpoint.inspectWorkspace).mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({ target: sshTarget, checkpointCommit: CHECKPOINT_COMMIT })
      );
    }
    expect(dependencies.checkpoint.validateCheckpointRange).toHaveBeenCalledWith(
      expect.objectContaining({ target: sshTarget })
    );
    expect(dependencies.requiredGate.run).toHaveBeenCalledWith(
      expect.objectContaining({ target: sshTarget })
    );
  });

  it.each([
    ['workspace ID', { ...sshTarget, workspaceId: 'other-workspace' }],
    ['path', { ...sshTarget, path: '/srv/other-loop' }],
    [
      'SSH connection ID',
      { ...sshTarget, machine: { kind: 'ssh' as const, connectionId: 'ssh-other' } },
    ],
  ])('treats a changed SSH %s as target drift', async (_label, sessionTarget) => {
    const { gate } = makeHarness({ target: sshTarget, sessionTarget });

    const result = await gate.run({ ...defaultInput, target: sshTarget });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'target-drift', stage: 'session-start' },
    });
  });

  it('refuses to start Review before every work phase has passed', async () => {
    const { gate, dependencies } = makeHarness();

    const result = await gate.run({
      ...defaultInput,
      workPhaseResults: [
        passedWorkResult,
        { ...passedWorkResult, status: 'failed', summary: 'Still broken.' },
      ],
    });

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'work-phases-incomplete',
        stageResult: { status: 'failed' },
      },
    });
    expect(dependencies.checkpoint.inspectWorkspace).not.toHaveBeenCalled();
    expect(dependencies.session.startFreshReviewSession).not.toHaveBeenCalled();
  });

  it('refuses an empty work-phase result set', async () => {
    const { gate, dependencies } = makeHarness();

    const result = await gate.run({ ...defaultInput, workPhaseResults: [] });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'work-phases-incomplete' },
    });
    expect(dependencies.session.startFreshReviewSession).not.toHaveBeenCalled();
  });

  it('rejects a reused conversation instead of treating it as a fresh Review session', async () => {
    const { gate, dependencies } = makeHarness({ conversationId: 'work-conversation' });

    const result = await gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'stale-conversation',
        conversationId: 'work-conversation',
      },
    });
    expect(dependencies.session.startFreshReviewSession).toHaveBeenCalledTimes(1);
    expect(dependencies.session.sendReviewPrompt).not.toHaveBeenCalled();
    expect(dependencies.session.cancelReviewSession).toHaveBeenCalledWith({
      conversationId: 'work-conversation',
      target: localTarget,
    });
  });

  it('scopes exactly-once cancellation to each run instead of retaining conversation IDs forever', async () => {
    const { gate, dependencies } = makeHarness({ conversationId: 'work-conversation' });

    await gate.run(defaultInput);
    await gate.run(defaultInput);

    expect(dependencies.session.cancelReviewSession).toHaveBeenCalledTimes(2);
    expect(dependencies.session.cancelReviewSession).toHaveBeenNthCalledWith(1, {
      conversationId: 'work-conversation',
      target: localTarget,
    });
    expect(dependencies.session.cancelReviewSession).toHaveBeenNthCalledWith(2, {
      conversationId: 'work-conversation',
      target: localTarget,
    });
  });

  it('cancels malformed session metadata against the authoritative input target', async () => {
    const { gate, dependencies } = makeHarness();
    vi.mocked(dependencies.session.startFreshReviewSession).mockResolvedValueOnce(
      ok({
        conversationId: 'malformed-target-conversation',
        target: undefined,
      } as unknown as ReviewSessionInfo)
    );

    const result = await gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { type: 'dependency-rejected', stage: 'session-start' },
    });
    expect(dependencies.session.cancelReviewSession).toHaveBeenCalledWith({
      conversationId: 'malformed-target-conversation',
      target: localTarget,
    });
  });

  it.each([
    ['missing', 'Review response omitted a sentinel.'],
    ['conflicting', '<<<LOOP:REVIEW_PASSED>>>\n<<<LOOP:REVIEW_FAILED contradictory>>>'],
    ['not-final', '<<<LOOP:REVIEW_PASSED>>>\nMore prose.'],
  ])('fails closed on a %s terminal sentinel', async (_label, finalText) => {
    const { gate, dependencies } = makeHarness({ finalText });

    const result = await gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { type: 'malformed-sentinel', stageResult: { status: 'failed' } },
    });
    expect(dependencies.requiredGate.run).not.toHaveBeenCalled();
  });

  it('returns a typed failed stage when the strict Review sentinel reports failure', async () => {
    const { gate, dependencies } = makeHarness({
      finalText: 'Review incomplete.\n<<<LOOP:REVIEW_FAILED focused tests are still red>>>',
    });

    const result = await gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'review-failed',
        message: 'focused tests are still red',
        stageResult: {
          status: 'failed',
          summary: 'Terminal Review failed: focused tests are still red',
        },
      },
    });
    expect(dependencies.requiredGate.run).not.toHaveBeenCalled();
  });

  it('returns a validated correction as recovery authority when the Review sentinel fails', async () => {
    const { gate, dependencies } = makeHarness({
      finalText: 'Review incomplete.\n<<<LOOP:REVIEW_FAILED integration test is red>>>',
      snapshots: [snapshot(localTarget), snapshot(localTarget, CORRECTION_COMMIT)],
    });

    const result = await gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'review-failed',
        checkpointCommit: CORRECTION_COMMIT,
        observedHead: CORRECTION_COMMIT,
        recoveryRequired: false,
      },
    });
    expect(dependencies.checkpoint.validateCorrection).toHaveBeenCalledTimes(1);
    expect(dependencies.requiredGate.run).not.toHaveBeenCalled();
  });

  it('returns a validated correction as recovery authority for a malformed sentinel', async () => {
    const { gate, dependencies } = makeHarness({
      finalText: 'Review response omitted its terminal sentinel.',
      snapshots: [snapshot(localTarget), snapshot(localTarget, CORRECTION_COMMIT)],
    });

    const result = await gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'malformed-sentinel',
        checkpointCommit: CORRECTION_COMMIT,
        observedHead: CORRECTION_COMMIT,
        recoveryRequired: false,
      },
    });
    expect(dependencies.checkpoint.validateCorrection).toHaveBeenCalledTimes(1);
    expect(dependencies.requiredGate.run).not.toHaveBeenCalled();
  });

  it('reconciles a changed HEAD before reporting a dirty Review workspace', async () => {
    const { gate, dependencies } = makeHarness({
      snapshots: [snapshot(localTarget), snapshot(localTarget, CORRECTION_COMMIT, false)],
    });

    const result = await gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'dirty-workspace',
        checkpointCommit: CORRECTION_COMMIT,
        observedHead: CORRECTION_COMMIT,
        recoveryRequired: false,
      },
    });
    expect(dependencies.checkpoint.validateCorrection).toHaveBeenCalledTimes(1);
    expect(dependencies.requiredGate.run).not.toHaveBeenCalled();
  });

  it('marks recovery required when an observed correction cannot be attested', async () => {
    const { gate, dependencies } = makeHarness({
      snapshots: [snapshot(localTarget), snapshot(localTarget, CORRECTION_COMMIT)],
      correctionFailure: dependencyError('correction attestation unavailable'),
    });

    const result = await gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'correction',
        checkpointCommit: CHECKPOINT_COMMIT,
        observedHead: CORRECTION_COMMIT,
        recoveryRequired: true,
      },
    });
    expect(dependencies.requiredGate.run).not.toHaveBeenCalled();
  });

  it('accepts exactly one validated Loop-owned correction checkpoint', async () => {
    const { gate, dependencies } = makeHarness({
      snapshots: [
        snapshot(localTarget),
        snapshot(localTarget, CORRECTION_COMMIT),
        snapshot(localTarget, CORRECTION_COMMIT),
      ],
      requiredGateResult: {
        target: localTarget,
        checkpointCommit: CORRECTION_COMMIT,
        summary: 'Correction gate passed.',
      },
    });

    const result = await gate.run(defaultInput);

    expect(result).toEqual(
      ok({
        purpose: 'review',
        conversationId: 'fresh-review-conversation',
        target: localTarget,
        previousCheckpointCommit: CHECKPOINT_COMMIT,
        checkpointCommit: CORRECTION_COMMIT,
        correctionApplied: true,
        requiredGateSummary: 'Correction gate passed.',
        stageResult: {
          status: 'passed',
          summary: 'Terminal Review and required gate passed with one correction checkpoint.',
          completedAt: '2026-07-12T01:02:03.000Z',
        },
      })
    );
    expect(dependencies.checkpoint.validateCorrection).toHaveBeenCalledWith({
      target: localTarget,
      baseCommit: BASE_COMMIT,
      previousCheckpointCommit: CHECKPOINT_COMMIT,
      checkpointCommit: CORRECTION_COMMIT,
      signal: undefined,
      deadlineAt: undefined,
    });
    expect(dependencies.requiredGate.run).toHaveBeenCalledWith(
      expect.objectContaining({ checkpointCommit: CORRECTION_COMMIT })
    );
  });

  it.each([
    ['multiple commits', { commitCount: 2 }, 'correction-count'],
    ['wrong parent', { parentCommit: OTHER_COMMIT }, 'non-linear-checkpoint'],
    ['non-linear history', { linear: false }, 'non-linear-checkpoint'],
    ['unowned commit', { loopOwned: false }, 'unowned-checkpoint'],
    ['mismatched checkpoint', { checkpointCommit: OTHER_COMMIT }, 'checkpoint-drift'],
  ] as const)(
    'rejects a %s correction before rerunning the required gate',
    async (_label, overrides, expectedType) => {
      const { gate, dependencies } = makeHarness({
        snapshots: [snapshot(localTarget), snapshot(localTarget, CORRECTION_COMMIT)],
        correctionValidation: correctionValidation(localTarget, overrides),
      });

      const result = await gate.run(defaultInput);

      expect(result).toMatchObject({ success: false, error: { type: expectedType } });
      expect(dependencies.requiredGate.run).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['non-linear', { linear: false }, 'non-linear-checkpoint'],
    ['unowned', { loopOwned: false }, 'unowned-checkpoint'],
    ['wrong base', { baseCommit: OTHER_COMMIT }, 'checkpoint-drift'],
    ['wrong checkpoint', { checkpointCommit: OTHER_COMMIT }, 'checkpoint-drift'],
  ] as const)(
    'rejects a %s authoritative checkpoint range before starting Review',
    async (_label, overrides, expectedType) => {
      const { gate, dependencies } = makeHarness({
        rangeValidation: rangeValidation(localTarget, overrides),
      });

      const result = await gate.run(defaultInput);

      expect(result).toMatchObject({ success: false, error: { type: expectedType } });
      expect(dependencies.session.startFreshReviewSession).not.toHaveBeenCalled();
    }
  );

  it('rejects a dirty workspace before starting the Review session', async () => {
    const { gate, dependencies } = makeHarness({
      snapshots: [snapshot(localTarget, CHECKPOINT_COMMIT, false)],
    });

    const result = await gate.run(defaultInput);

    expect(result).toMatchObject({ success: false, error: { type: 'dirty-workspace' } });
    expect(dependencies.session.startFreshReviewSession).not.toHaveBeenCalled();
  });

  it('rejects a dirty workspace left by Review before accepting its sentinel', async () => {
    const { gate, dependencies } = makeHarness({
      snapshots: [snapshot(localTarget), snapshot(localTarget, CHECKPOINT_COMMIT, false)],
    });

    const result = await gate.run(defaultInput);

    expect(result).toMatchObject({ success: false, error: { type: 'dirty-workspace' } });
    expect(dependencies.requiredGate.run).not.toHaveBeenCalled();
  });

  it('rejects files generated by the required gate instead of returning a dirty checkpoint', async () => {
    const { gate } = makeHarness({
      snapshots: [
        snapshot(localTarget),
        snapshot(localTarget),
        snapshot(localTarget, CHECKPOINT_COMMIT, false),
      ],
    });

    const result = await gate.run(defaultInput);

    expect(result).toMatchObject({ success: false, error: { type: 'dirty-workspace' } });
  });

  it('rejects feature-head drift before Review starts', async () => {
    const { gate, dependencies } = makeHarness({
      snapshots: [snapshot(localTarget, OTHER_COMMIT)],
    });

    const result = await gate.run(defaultInput);

    expect(result).toMatchObject({ success: false, error: { type: 'checkpoint-drift' } });
    expect(dependencies.session.startFreshReviewSession).not.toHaveBeenCalled();
  });

  it.each([
    ['workspace inspection', [snapshot(sshTarget)], undefined, undefined],
    ['session binding', undefined, sshTarget, undefined],
    [
      'required gate echo',
      undefined,
      undefined,
      { target: sshTarget, checkpointCommit: CHECKPOINT_COMMIT, summary: 'Wrong target.' },
    ],
  ] as const)(
    'fails closed on target drift from %s',
    async (_label, snapshots, target, gateResult) => {
      const { gate } = makeHarness({
        ...(snapshots ? { snapshots: [...snapshots] } : {}),
        ...(target ? { sessionTarget: target } : {}),
        ...(gateResult ? { requiredGateResult: gateResult } : {}),
      });

      const result = await gate.run(defaultInput);

      expect(result).toMatchObject({ success: false, error: { type: 'target-drift' } });
    }
  );

  it('rejects checkpoint drift reported by the required gate', async () => {
    const { gate } = makeHarness({
      requiredGateResult: {
        target: localTarget,
        checkpointCommit: OTHER_COMMIT,
        summary: 'Ran against the wrong commit.',
      },
    });

    const result = await gate.run(defaultInput);

    expect(result).toMatchObject({ success: false, error: { type: 'checkpoint-drift' } });
  });

  it.each([
    ['inspect', { inspectFailure: dependencyError('inspect rejected') }, 'dependency-rejected'],
    ['range', { rangeFailure: dependencyError('range rejected') }, 'dependency-rejected'],
    ['start', { startFailure: dependencyError('start rejected') }, 'dependency-rejected'],
    ['prompt', { promptFailure: dependencyError('prompt rejected') }, 'dependency-rejected'],
    [
      'required gate',
      { requiredGateFailure: dependencyError('required gate rejected') },
      'required-gate-failed',
    ],
  ] as const)(
    'fails closed when the %s dependency rejects',
    async (_label, options, expectedType) => {
      const { gate } = makeHarness(options);

      const result = await gate.run(defaultInput);

      expect(result).toMatchObject({ success: false, error: { type: expectedType } });
    }
  );

  it('maps a thrown dependency to a typed rejection', async () => {
    const { gate, dependencies } = makeHarness();
    vi.mocked(dependencies.checkpoint.inspectWorkspace).mockRejectedValueOnce(
      new Error('inspection exploded')
    );

    const result = await gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        message: 'Workspace inspection failed: inspection exploded',
      },
    });
  });

  it('maps a malformed dependency result to a typed rejection', async () => {
    const { gate, dependencies } = makeHarness();
    vi.mocked(dependencies.checkpoint.inspectWorkspace).mockResolvedValueOnce(
      undefined as unknown as Result<ReviewWorkspaceSnapshot, ReviewGateDependencyError>
    );

    const result = await gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        message: 'Workspace inspection failed: dependency returned an invalid result.',
      },
    });
  });

  it('fails before any dependency when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { gate, dependencies } = makeHarness();

    const result = await gate.run({ ...defaultInput, signal: controller.signal });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'cancelled', stageResult: { status: 'cancelled' } },
    });
    expect(dependencies.checkpoint.inspectWorkspace).not.toHaveBeenCalled();
  });

  it('fails before any dependency when the deadline has expired', async () => {
    const { gate, dependencies } = makeHarness();

    const result = await gate.run({ ...defaultInput, deadlineAt: Date.now() - 1 });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'deadline-exceeded', stageResult: { status: 'interrupted' } },
    });
    expect(dependencies.checkpoint.inspectWorkspace).not.toHaveBeenCalled();
  });

  it('races a held workspace inspection with cancellation and ignores its late success', async () => {
    const controller = new AbortController();
    const held = deferred<Result<ReviewWorkspaceSnapshot, ReviewGateDependencyError>>();
    const { gate, dependencies } = makeHarness();
    vi.mocked(dependencies.checkpoint.inspectWorkspace).mockReturnValueOnce(held.promise);

    const running = gate.run({ ...defaultInput, signal: controller.signal });
    await vi.waitFor(() =>
      expect(dependencies.checkpoint.inspectWorkspace).toHaveBeenCalledTimes(1)
    );
    controller.abort();
    const result = await running;
    held.resolve(ok(snapshot(localTarget)));
    await Promise.resolve();

    expect(result).toMatchObject({
      success: false,
      error: { type: 'cancelled', stage: 'preflight' },
    });
    expect(dependencies.session.startFreshReviewSession).not.toHaveBeenCalled();
    expect(dependencies.session.cancelReviewSession).not.toHaveBeenCalled();
  });

  it('closes the abort-listener registration race before awaiting a dependency', async () => {
    let aborted = false;
    const signal = {
      get aborted() {
        return aborted;
      },
      addEventListener() {
        aborted = true;
      },
      removeEventListener() {},
    } as unknown as AbortSignal;
    const { gate, dependencies } = makeHarness();
    vi.mocked(dependencies.checkpoint.inspectWorkspace).mockImplementationOnce(
      () => new Promise(() => undefined)
    );

    const result = await gate.run({ ...defaultInput, signal });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'cancelled', stage: 'preflight' },
    });
    expect(dependencies.session.startFreshReviewSession).not.toHaveBeenCalled();
  });

  it('races a held workspace inspection with the deadline', async () => {
    vi.useFakeTimers();
    try {
      const held = deferred<Result<ReviewWorkspaceSnapshot, ReviewGateDependencyError>>();
      const { gate, dependencies } = makeHarness();
      vi.mocked(dependencies.checkpoint.inspectWorkspace).mockReturnValueOnce(held.promise);

      const running = gate.run({ ...defaultInput, deadlineAt: Date.now() + 25 });
      await vi.advanceTimersByTimeAsync(25);
      const result = await running;

      expect(result).toMatchObject({
        success: false,
        error: { type: 'deadline-exceeded', stage: 'preflight' },
      });
      expect(dependencies.session.startFreshReviewSession).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('races held checkpoint-range validation before session creation', async () => {
    const controller = new AbortController();
    const held = deferred<Result<ReviewCheckpointRangeValidation, ReviewGateDependencyError>>();
    const { gate, dependencies } = makeHarness();
    vi.mocked(dependencies.checkpoint.validateCheckpointRange).mockReturnValueOnce(held.promise);

    const running = gate.run({ ...defaultInput, signal: controller.signal });
    await vi.waitFor(() =>
      expect(dependencies.checkpoint.validateCheckpointRange).toHaveBeenCalledTimes(1)
    );
    controller.abort();
    const result = await running;
    held.resolve(ok(rangeValidation(localTarget)));
    await Promise.resolve();

    expect(result).toMatchObject({
      success: false,
      error: { type: 'cancelled', stage: 'preflight' },
    });
    expect(dependencies.session.startFreshReviewSession).not.toHaveBeenCalled();
  });

  it('cancels exactly once when held session creation succeeds after cancellation', async () => {
    const controller = new AbortController();
    const held = deferred<Result<ReviewSessionInfo, ReviewGateDependencyError>>();
    const { gate, dependencies } = makeHarness();
    vi.mocked(dependencies.session.startFreshReviewSession).mockReturnValueOnce(held.promise);

    const running = gate.run({ ...defaultInput, signal: controller.signal });
    const hasSettled = settlementTracker(running);
    await vi.waitFor(() =>
      expect(dependencies.session.startFreshReviewSession).toHaveBeenCalledTimes(1)
    );
    controller.abort();
    await Promise.resolve();
    expect(hasSettled()).toBe(false);
    held.resolve(ok({ conversationId: 'late-review-conversation', target: sshTarget }));
    await vi.waitFor(() =>
      expect(dependencies.session.cancelReviewSession).toHaveBeenCalledTimes(1)
    );
    const result = await running;

    expect(result).toMatchObject({
      success: false,
      error: { type: 'cancelled', stage: 'session-start' },
    });
    expect(dependencies.session.cancelReviewSession).toHaveBeenCalledWith({
      conversationId: 'late-review-conversation',
      target: localTarget,
    });
    expect(dependencies.session.sendReviewPrompt).not.toHaveBeenCalled();
  });

  it('cancels the fresh session when the caller aborts a held Review prompt', async () => {
    const controller = new AbortController();
    let resolvePrompt:
      | ((value: Result<{ finalText: string }, ReviewGateDependencyError>) => void)
      | undefined;
    const heldPrompt = new Promise<Result<{ finalText: string }, ReviewGateDependencyError>>(
      (resolve) => {
        resolvePrompt = resolve;
      }
    );
    const heldCancellation =
      deferred<Result<ReviewSessionCancellation, ReviewGateDependencyError>>();
    const { gate, dependencies } = makeHarness();
    vi.mocked(dependencies.session.sendReviewPrompt).mockReturnValueOnce(heldPrompt);
    vi.mocked(dependencies.session.cancelReviewSession).mockReturnValueOnce(
      heldCancellation.promise
    );

    const running = gate.run({ ...defaultInput, signal: controller.signal });
    const hasSettled = settlementTracker(running);
    await vi.waitFor(() => expect(dependencies.session.sendReviewPrompt).toHaveBeenCalledTimes(1));
    controller.abort();
    await vi.waitFor(() =>
      expect(dependencies.session.cancelReviewSession).toHaveBeenCalledTimes(1)
    );
    await Promise.resolve();
    expect(hasSettled()).toBe(false);
    heldCancellation.resolve(
      ok({
        conversationId: 'fresh-review-conversation',
        target: localTarget,
        quiescent: true,
      })
    );
    const result = await running;
    resolvePrompt?.(ok({ finalText: 'late\n<<<LOOP:REVIEW_PASSED>>>' }));
    await Promise.resolve();

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cancelled',
        conversationId: 'fresh-review-conversation',
        stageResult: { status: 'cancelled' },
      },
    });
    expect(dependencies.session.cancelReviewSession).toHaveBeenCalledWith({
      conversationId: 'fresh-review-conversation',
      target: localTarget,
    });
    expect(dependencies.session.cancelReviewSession).toHaveBeenCalledTimes(1);
    expect(dependencies.requiredGate.run).not.toHaveBeenCalled();
  });

  it('surfaces prompt-quiescence rejection as a typed cleanup failure', async () => {
    const { gate, dependencies } = makeHarness({
      promptFailure: dependencyError('prompt transport failed'),
      cancellationFailure: dependencyError('prompt did not quiesce'),
    });

    const result = await gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cleanup-failed',
        stage: 'prompt',
        message: 'Review session quiescence failed: prompt did not quiesce',
      },
    });
    expect(dependencies.session.cancelReviewSession).toHaveBeenCalledTimes(1);
    expect(dependencies.requiredGate.run).not.toHaveBeenCalled();
  });

  it('rejects a quiescence acknowledgement bound to a different target', async () => {
    const { gate, dependencies } = makeHarness({
      promptFailure: dependencyError('prompt transport failed'),
      cancellationResult: {
        conversationId: 'fresh-review-conversation',
        target: sshTarget,
        quiescent: true,
      },
    });

    const result = await gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { type: 'cleanup-failed', stage: 'prompt' },
    });
    expect(dependencies.session.cancelReviewSession).toHaveBeenCalledTimes(1);
  });

  it('checks workspace authority only after a cancelled prompt acknowledges quiescence', async () => {
    const controller = new AbortController();
    const heldCancellation =
      deferred<Result<ReviewSessionCancellation, ReviewGateDependencyError>>();
    const { gate, dependencies } = makeHarness({
      snapshots: [snapshot(localTarget), snapshot(localTarget, CORRECTION_COMMIT)],
    });
    vi.mocked(dependencies.session.sendReviewPrompt).mockImplementationOnce(
      () => new Promise(() => undefined)
    );
    vi.mocked(dependencies.session.cancelReviewSession).mockReturnValueOnce(
      heldCancellation.promise
    );

    const running = gate.run({ ...defaultInput, signal: controller.signal });
    const hasSettled = settlementTracker(running);
    await vi.waitFor(() => expect(dependencies.session.sendReviewPrompt).toHaveBeenCalledTimes(1));
    controller.abort();
    await vi.waitFor(() =>
      expect(dependencies.session.cancelReviewSession).toHaveBeenCalledTimes(1)
    );
    expect(hasSettled()).toBe(false);
    heldCancellation.resolve(
      ok({
        conversationId: 'fresh-review-conversation',
        target: localTarget,
        quiescent: true,
      })
    );
    const result = await running;

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cancelled',
        stage: 'prompt',
        checkpointCommit: CORRECTION_COMMIT,
        observedHead: CORRECTION_COMMIT,
        recoveryRequired: false,
      },
    });
    expect(dependencies.checkpoint.inspectWorkspace).toHaveBeenCalledTimes(2);
    expect(dependencies.checkpoint.validateCorrection).toHaveBeenCalledTimes(1);
    expect(dependencies.requiredGate.run).not.toHaveBeenCalled();
  });

  it('re-inspects authority when cancellation races the first post-prompt inspection', async () => {
    const controller = new AbortController();
    const held = deferred<Result<ReviewWorkspaceSnapshot, ReviewGateDependencyError>>();
    const { gate, dependencies } = makeHarness();
    vi.mocked(dependencies.checkpoint.inspectWorkspace)
      .mockResolvedValueOnce(ok(snapshot(localTarget)))
      .mockReturnValueOnce(held.promise)
      .mockResolvedValueOnce(ok(snapshot(localTarget, CORRECTION_COMMIT)));

    const running = gate.run({ ...defaultInput, signal: controller.signal });
    await vi.waitFor(() =>
      expect(dependencies.checkpoint.inspectWorkspace).toHaveBeenCalledTimes(2)
    );
    controller.abort();
    const result = await running;

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cancelled',
        stage: 'post-review',
        checkpointCommit: CORRECTION_COMMIT,
        observedHead: CORRECTION_COMMIT,
        recoveryRequired: false,
      },
    });
    expect(dependencies.checkpoint.inspectWorkspace).toHaveBeenCalledTimes(3);
    expect(dependencies.checkpoint.validateCorrection).toHaveBeenCalledTimes(1);
    expect(dependencies.session.cancelReviewSession).toHaveBeenCalledTimes(1);
  });

  it('can stop a held read-only correction validation without cancelling a settled prompt', async () => {
    const controller = new AbortController();
    const held = deferred<Result<ReviewCorrectionValidation, ReviewGateDependencyError>>();
    const { gate, dependencies } = makeHarness({
      snapshots: [snapshot(localTarget), snapshot(localTarget, CORRECTION_COMMIT)],
    });
    vi.mocked(dependencies.checkpoint.validateCorrection).mockReturnValueOnce(held.promise);

    const running = gate.run({ ...defaultInput, signal: controller.signal });
    await vi.waitFor(() =>
      expect(dependencies.checkpoint.validateCorrection).toHaveBeenCalledTimes(1)
    );
    controller.abort();
    const result = await running;
    held.resolve(ok(correctionValidation(localTarget)));
    await Promise.resolve();

    expect(result).toMatchObject({
      success: false,
      error: { type: 'cancelled', stage: 'correction' },
    });
    expect(dependencies.session.cancelReviewSession).not.toHaveBeenCalled();
    expect(dependencies.requiredGate.run).not.toHaveBeenCalled();
  });

  it('cancels exactly once when the required gate is held and then settles late', async () => {
    const controller = new AbortController();
    const held = deferred<Result<ReviewRequiredGateResult, ReviewGateDependencyError>>();
    const { gate, dependencies } = makeHarness();
    vi.mocked(dependencies.requiredGate.run).mockReturnValueOnce(held.promise);

    const running = gate.run({ ...defaultInput, signal: controller.signal });
    const hasSettled = settlementTracker(running);
    await vi.waitFor(() => expect(dependencies.requiredGate.run).toHaveBeenCalledTimes(1));
    controller.abort();
    await Promise.resolve();
    expect(hasSettled()).toBe(false);
    held.resolve(
      ok({
        target: localTarget,
        checkpointCommit: CHECKPOINT_COMMIT,
        summary: 'Late gate pass.',
      })
    );
    const result = await running;

    expect(result).toMatchObject({
      success: false,
      error: { type: 'cancelled', stage: 'required-gate' },
    });
    expect(dependencies.session.cancelReviewSession).toHaveBeenCalledTimes(1);
    expect(dependencies.checkpoint.inspectWorkspace).toHaveBeenCalledTimes(3);
  });

  it('waits for required-gate abort settlement before reporting its late mutation', async () => {
    const controller = new AbortController();
    const held = deferred<Result<ReviewRequiredGateResult, ReviewGateDependencyError>>();
    const { gate, dependencies } = makeHarness({
      snapshots: [
        snapshot(localTarget),
        snapshot(localTarget),
        snapshot(localTarget, OTHER_COMMIT),
      ],
    });
    vi.mocked(dependencies.requiredGate.run).mockReturnValueOnce(held.promise);

    const running = gate.run({ ...defaultInput, signal: controller.signal });
    const hasSettled = settlementTracker(running);
    await vi.waitFor(() => expect(dependencies.requiredGate.run).toHaveBeenCalledTimes(1));
    controller.abort();
    await Promise.resolve();
    expect(hasSettled()).toBe(false);
    held.resolve(
      ok({
        target: localTarget,
        checkpointCommit: CHECKPOINT_COMMIT,
        summary: 'Late gate mutated the workspace.',
      })
    );
    const result = await running;

    expect(result).toMatchObject({
      success: false,
      error: { type: 'checkpoint-drift', stage: 'required-gate' },
    });
    expect(dependencies.session.cancelReviewSession).toHaveBeenCalledTimes(1);
    expect(dependencies.checkpoint.inspectWorkspace).toHaveBeenCalledTimes(3);
  });

  it('cancels exactly once when final workspace inspection is held', async () => {
    const controller = new AbortController();
    const held = deferred<Result<ReviewWorkspaceSnapshot, ReviewGateDependencyError>>();
    const { gate, dependencies } = makeHarness();
    vi.mocked(dependencies.checkpoint.inspectWorkspace)
      .mockResolvedValueOnce(ok(snapshot(localTarget)))
      .mockResolvedValueOnce(ok(snapshot(localTarget)))
      .mockReturnValueOnce(held.promise)
      .mockResolvedValueOnce(ok(snapshot(localTarget, OTHER_COMMIT)));

    const running = gate.run({ ...defaultInput, signal: controller.signal });
    await vi.waitFor(() =>
      expect(dependencies.checkpoint.inspectWorkspace).toHaveBeenCalledTimes(3)
    );
    controller.abort();
    const result = await running;
    held.resolve(ok(snapshot(localTarget)));
    await Promise.resolve();

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'checkpoint-drift',
        stage: 'finalize',
        checkpointCommit: CHECKPOINT_COMMIT,
        observedHead: OTHER_COMMIT,
        recoveryRequired: true,
      },
    });
    expect(dependencies.session.cancelReviewSession).toHaveBeenCalledTimes(1);
    expect(dependencies.checkpoint.inspectWorkspace).toHaveBeenCalledTimes(4);
  });

  it('cancels the fresh session when a held Review prompt reaches its deadline', async () => {
    vi.useFakeTimers();
    try {
      const { gate, dependencies } = makeHarness();
      vi.mocked(dependencies.session.sendReviewPrompt).mockImplementationOnce(
        () => new Promise(() => undefined)
      );
      const running = gate.run({ ...defaultInput, deadlineAt: Date.now() + 25 });
      await vi.advanceTimersByTimeAsync(25);

      const result = await running;

      expect(result).toMatchObject({
        success: false,
        error: {
          type: 'deadline-exceeded',
          conversationId: 'fresh-review-conversation',
          stageResult: { status: 'interrupted' },
        },
      });
      expect(dependencies.session.cancelReviewSession).toHaveBeenCalledWith({
        conversationId: 'fresh-review-conversation',
        target: localTarget,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['invalid commit', { checkpointCommit: 'short' }],
    ['blank model', { model: '   ' }],
    ['oversized model', { model: 'm'.repeat(257) }],
    ['oversized goal', { goal: 'g'.repeat(16_385) }],
    [
      'too many acceptance criteria',
      { acceptanceCriteria: Array.from({ length: 65 }, (_, index) => `criterion-${index}`) },
    ],
    ['oversized prior conversation ID', { previousConversationIds: ['c'.repeat(257)] }],
    ['whitespace-padded prior conversation ID', { previousConversationIds: [' work-id '] }],
    ['duplicate prior conversation IDs', { previousConversationIds: ['same', 'same'] }],
    ['malformed work result', { workPhaseResults: [{ ...passedWorkResult, status: 'unknown' }] }],
    ['invalid deadline', { deadlineAt: Number.NaN }],
    ['invalid target', { target: { workspaceId: '', path: '/tmp/x', machine: { kind: 'local' } } }],
  ] as const)('rejects %s input before starting a session', async (_label, override) => {
    const { gate, dependencies } = makeHarness();

    const result = await gate.run({ ...defaultInput, ...override } as RunTerminalReviewGateInput);

    expect(result).toMatchObject({ success: false, error: { type: 'invalid-input' } });
    expect(dependencies.session.startFreshReviewSession).not.toHaveBeenCalled();
  });

  it('rejects aggregate prompt data over the bounded handoff budget before dependencies run', async () => {
    const handoffs = Array.from({ length: 40 }, (_, index) => ({
      source: `phase-${index}`,
      handoff: {
        summary: 'x'.repeat(16_384),
        risks: [],
        remainingWork: [],
        artifacts: [],
        createdAt: '2026-07-12T00:00:00.000Z',
      },
    }));
    const { gate, dependencies } = makeHarness();

    const result = await gate.run({ ...defaultInput, handoffs });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'invalid-input', stage: 'precondition' },
    });
    expect(dependencies.checkpoint.inspectWorkspace).not.toHaveBeenCalled();
    expect(dependencies.session.startFreshReviewSession).not.toHaveBeenCalled();
  });
});
