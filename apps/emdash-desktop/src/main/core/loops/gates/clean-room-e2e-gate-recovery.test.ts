import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@main/lib/result';
import type { LoopSessionAttempt, LoopSessionTarget } from '@shared/core/loops/loop-state';
import type { CleanRoomProject } from '../clean-room/clean-room-workspace-service';
import type { CleanRoomPendingCleanup } from '../clean-room/cleanup-journal';
import type { CleanRoomE2EGateDependencies } from './clean-room-e2e-gate';
import {
  BASE_COMMIT,
  FEATURE_COMMIT,
  FIX_COMMIT,
  cleanTargetFor,
  defaultInput,
  environment,
  featureTarget,
  historicalAttempts,
  loop,
  loopWithConfig,
  loopWithState,
  makeHarness,
  makePendingCleanup,
  mutateRequiredChecksOnce,
  nestedAttempt,
  passedStage,
  phase,
  project,
  requiredChecksResult,
  sshFeatureTarget,
  whitespaceAlias,
  type Harness,
} from './clean-room-e2e-gate.test-harness';

describe('CleanRoomE2EGate recovery and authority', () => {
  it('reconciles uncontrolled feature authority after integration even when cleanup observes abort', async () => {
    const controller = new AbortController();
    const harness = makeHarness([
      {
        finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
    ]);
    const destroy = vi.mocked(harness.dependencies.cleanRoom.destroy);
    const originalDestroy = destroy.getMockImplementation()!;
    destroy.mockImplementationOnce(async (...args) => {
      const result = await originalDestroy(...args);
      controller.abort();
      return result;
    });

    const result = await harness.gate.run({ ...defaultInput, signal: controller.signal });

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cancelled',
        stage: 'correction',
        featureHead: FIX_COMMIT,
        lastWorkspaceDestroyed: true,
      },
    });
    expect(harness.dependencies.authority.inspectFeature).toHaveBeenCalledTimes(2);
    expect(vi.mocked(harness.dependencies.authority.inspectFeature).mock.calls).toEqual([
      [{ target: featureTarget, expectedFeatureHead: FIX_COMMIT }],
      [{ target: featureTarget, expectedFeatureHead: FIX_COMMIT }],
    ]);
  });

  it('reconciles integrated feature authority before a later clean-room creation fails', async () => {
    const harness = makeHarness([
      {
        finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
      { finalText: '<<<LOOP:E2E_PASSED>>>' },
    ]);
    const create = vi.mocked(harness.dependencies.cleanRoom.create);
    const originalCreate = create.getMockImplementation()!;
    create.mockImplementationOnce(originalCreate).mockImplementationOnce(async (input) => {
      harness.calls.push(`create:${input.attempt}:${input.expectedFeatureHead}`);
      return err({ message: 'next clean-room creation failed' });
    });

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'create',
        featureHead: FIX_COMMIT,
        attempt: 2,
      },
    });
    expect(harness.dependencies.authority.inspectFeature).toHaveBeenCalled();
    expect(vi.mocked(harness.dependencies.authority.inspectFeature).mock.calls).toEqual(
      expect.arrayContaining([
        [
          {
            target: featureTarget,
            expectedFeatureHead: FIX_COMMIT,
          },
        ],
      ])
    );
    expect(harness.calls.indexOf(`feature:1:${FIX_COMMIT}`)).toBeLessThan(
      harness.calls.indexOf(`create:2:${FIX_COMMIT}`)
    );
  });

  it('reconciles feature authority while preserving post-integration release failure', async () => {
    const harness = makeHarness([
      {
        finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
    ]);
    vi.mocked(harness.dependencies.execution.release).mockResolvedValueOnce(
      err({ type: 'cleanup-failed', message: 'execution remained acquired' })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cleanup-failed',
        stage: 'cleanup',
        featureHead: FIX_COMMIT,
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        intermediateFailures: [{ source: 'Clean-room E2E correction' }],
      },
    });
    expect(harness.dependencies.cleanRoom.integrateFix).toHaveBeenCalledOnce();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
    expect(harness.dependencies.authority.inspectFeature).toHaveBeenCalledTimes(2);
    expect(vi.mocked(harness.dependencies.authority.inspectFeature).mock.calls).toEqual([
      [{ target: featureTarget, expectedFeatureHead: FIX_COMMIT }],
      [{ target: featureTarget, expectedFeatureHead: FIX_COMMIT }],
    ]);
  });

  it('rejects a malformed AbortSignal before creating a clean room', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);

    const result = await harness.gate.run({
      ...defaultInput,
      signal: { aborted: false } as AbortSignal,
    });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'invalid-input', stage: 'precondition', attempt: 0 },
    });
    expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
  });

  it('isolates full-check context mutation while retaining the active outer conversation', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const checks = vi.mocked(harness.dependencies.requiredChecks.run);
    const original = checks.getMockImplementation()!;
    checks.mockImplementationOnce(async (input) => {
      expect(input.authority.outerConversationId).toBe('e2e-conversation-1');
      input.authority.loopId = 'mutated-copy';
      input.authority.phaseId = 'mutated-copy';
      return original(input);
    });

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { type: 'required-checks-authority-invalid', stage: 'required-checks' },
    });
    expect(defaultInput.loop.id).toBe(loop.id);
    expect(defaultInput.phase.id).toBe(phase.id);
  });

  it('retains an exact nested attempt when required checks reject after quiescence', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.requiredChecks.run).mockImplementationOnce(async (input) =>
      err({
        message: 'checks rejected after nested verification',
        quiescent: true,
        sessionAttempts: [nestedAttempt(input.sessionIdentity)],
      })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        stage: 'required-checks',
        sessionAttempts: [
          { purpose: 'e2e', status: 'failed' },
          { purpose: 'browser-verification', status: 'completed' },
        ],
      },
    });
  });

  it('reports the latest reconciled head when authority drifts immediately after integration', async () => {
    const harness = makeHarness([
      {
        finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
    ]);
    const concurrentHead = '4'.repeat(40);
    vi.mocked(harness.dependencies.authority.inspectFeature).mockResolvedValueOnce(
      ok({
        target: featureTarget,
        headCommit: concurrentHead,
        clean: true,
        branchAttached: true,
      })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'feature-head-drift',
        stage: 'correction',
        featureHead: FIX_COMMIT,
        recoveryRequired: true,
        lastWorkspaceDestroyed: true,
      },
    });
  });

  it('ignores matching cleanup data claimed by the execution-release port', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const create = vi.mocked(harness.dependencies.cleanRoom.create);
    const originalCreate = create.getMockImplementation()!;
    create.mockImplementationOnce(async (input) => {
      const created = await originalCreate(input);
      if (!created.success) return created;
      return ok({
        ...created.data,
        target: {
          workspaceId: 'loop-verify-1',
          path: '/tmp/loop-verify-1',
          machine: { kind: 'local' },
        },
        branchName: 'emdash/loop-verify-1',
      });
    });
    const pendingCleanup: CleanRoomPendingCleanup = {
      version: '1',
      cleanupId: 'cleanup-loop-verify-1',
      verificationRunId: 'verification-run-1',
      attempt: 1,
      projectId: project.projectId,
      workspaceId: 'loop-verify-1',
      target: { path: '/tmp/loop-verify-1', machine: { kind: 'local' } },
      featureTarget,
      branchName: 'emdash/loop-verify-1',
      baseCommit: BASE_COMMIT,
      expectedFeatureHead: FEATURE_COMMIT,
      worktreeOwnership: 'attested',
      teardownRequired: true,
      branchHead: FEATURE_COMMIT,
      completed: { teardown: false, worktree: false, branch: false },
      revision: 7,
    };
    vi.mocked(harness.dependencies.execution.release).mockResolvedValueOnce(
      err({ type: 'cleanup-failed', message: 'release failed', pendingCleanup })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { type: 'cleanup-failed', recoveryRequired: true },
    });
    if (result.success) throw new Error('Expected cleanup failure.');
    expect(result.error).not.toHaveProperty('pendingCleanup');
  });

  it('preserves an exact Lane-W cleanup record returned by clean-room creation', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const pendingCleanup = makePendingCleanup();
    vi.mocked(harness.dependencies.cleanRoom.create).mockResolvedValueOnce(
      err({
        type: 'cleanup-failed',
        message: 'creation failed after durable worktree allocation',
        pendingCleanup,
      })
    );

    const result = await harness.gate.run(defaultInput);
    pendingCleanup.revision = 99;
    pendingCleanup.completed.worktree = true;

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cleanup-failed',
        stage: 'create',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        pendingCleanup: {
          cleanupId: 'cleanup-loop-verify-1',
          verificationRunId: 'verification-run-1',
          projectId: project.projectId,
          workspaceId: 'loop-verify-1',
          expectedFeatureHead: FEATURE_COMMIT,
          revision: 1,
          completed: { teardown: false, worktree: false, branch: false },
        },
      },
    });
    expect(harness.dependencies.execution.acquire).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it('clears preparing authority only when creation explicitly proves quiescence', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.cleanRoom.create).mockResolvedValueOnce(
      err({
        message: 'Creation stopped before producing a workspace.',
        quiescent: true,
        recoveryRequired: false,
      })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { stage: 'create', lastWorkspaceDestroyed: true },
    });
    const workspaceTransitions = vi
      .mocked(harness.dependencies.progress.commit)
      .mock.calls.map(([call]) => call.transition)
      .filter((transition) => transition.kind === 'workspace');
    expect(workspaceTransitions).toEqual([
      expect.objectContaining({
        kind: 'workspace',
        verification: expect.objectContaining({ status: 'preparing' }),
      }),
      { kind: 'workspace', verification: null },
    ]);
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a malformed result',
      (harness: Harness) =>
        vi.mocked(harness.dependencies.cleanRoom.create).mockResolvedValueOnce({} as never),
    ],
    [
      'a rejected transport',
      (harness: Harness) =>
        vi
          .mocked(harness.dependencies.cleanRoom.create)
          .mockRejectedValueOnce(new Error('create transport disconnected')),
    ],
  ] as const)('reports unknown recovery when creation has %s', async (_name, arrange) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    arrange(harness);

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'create',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
      },
    });
    expect(harness.dependencies.execution.acquire).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it.each([
    ['explicit recovery authority', { recoveryRequired: true }],
    ['explicit non-quiescence authority', { quiescent: false }],
  ] as const)('retains preparing authority when creation reports %s', async (_name, authority) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.cleanRoom.create).mockResolvedValueOnce(
      err({ message: 'Creation may have crossed its effect boundary.', ...authority })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        stage: 'create',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
      },
    });
    const workspaceTransitions = vi
      .mocked(harness.dependencies.progress.commit)
      .mock.calls.map(([call]) => call.transition)
      .filter((transition) => transition.kind === 'workspace');
    expect(workspaceTransitions).toEqual([
      expect.objectContaining({
        kind: 'workspace',
        verification: expect.objectContaining({ status: 'preparing' }),
      }),
    ]);
    expect(harness.dependencies.execution.acquire).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it.each([
    ['explicit recovery authority', { recoveryRequired: true }],
    ['explicit non-quiescence authority', { quiescent: false }],
  ] as const)(
    'retains the ready workspace when acquisition reports %s',
    async (_name, authority) => {
      const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
      vi.mocked(harness.dependencies.execution.acquire).mockResolvedValueOnce(
        err({ message: 'Acquisition may have established a live execution.', ...authority })
      );

      const result = await harness.gate.run(defaultInput);

      expect(result).toMatchObject({
        success: false,
        error: {
          stage: 'execution',
          recoveryRequired: true,
          lastWorkspaceDestroyed: false,
          pendingWorkspace: { cleanupId: 'cleanup-loop-verify-1' },
        },
      });
      expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
      expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
    }
  );

  it('destroys a ready workspace when acquisition explicitly proves quiescence', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.execution.acquire).mockResolvedValueOnce(
      err({
        message: 'Acquisition rejected before establishing execution.',
        quiescent: true,
        recoveryRequired: false,
      })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { stage: 'execution', lastWorkspaceDestroyed: true },
    });
    expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'a callable duck type',
      Object.assign(() => undefined, {
        aborted: false,
        addEventListener: () => undefined,
        removeEventListener: (): void => undefined,
      }),
    ],
    [
      'a listener that throws when called',
      {
        aborted: false,
        addEventListener: () => {
          throw new Error('hostile listener');
        },
        removeEventListener: (): void => undefined,
      },
    ],
    [
      'an aborted getter that throws',
      Object.defineProperty({}, 'aborted', {
        enumerable: true,
        get: () => {
          throw new Error('hostile aborted getter');
        },
      }),
    ],
  ] as const)('rejects %s as an AbortSignal before clean-room creation', async (_name, signal) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);

    const run = harness.gate.run({ ...defaultInput, signal: signal as AbortSignal });

    await expect(run).resolves.toMatchObject({
      success: false,
      error: { type: 'invalid-input', stage: 'precondition', attempt: 0 },
    });
    expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a throwing success accessor',
      Object.defineProperty({}, 'success', {
        enumerable: true,
        get: () => {
          throw new Error('hostile success accessor');
        },
      }),
    ],
    [
      'a throwing error accessor',
      Object.defineProperties(
        {},
        {
          success: { enumerable: true, value: false },
          error: {
            enumerable: true,
            get: () => {
              throw new Error('hostile error accessor');
            },
          },
        }
      ),
    ],
  ] as const)('contains %s from a live prompt dependency', async (_name, malformedResult) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.session.sendE2EPrompt).mockResolvedValueOnce(
      malformedResult as never
    );

    const run = harness.gate.run(defaultInput);

    await expect(run).resolves.toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'prompt',
        lastWorkspaceDestroyed: true,
      },
    });
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledOnce();
    expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it('contains rejection coercion that throws after a live session starts', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const hostileCause = {
      toString: () => {
        throw new Error('hostile rejection coercion');
      },
    };
    vi.mocked(harness.dependencies.session.sendE2EPrompt).mockRejectedValueOnce(hostileCause);

    const run = harness.gate.run(defaultInput);

    await expect(run).resolves.toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'prompt',
        lastWorkspaceDestroyed: true,
      },
    });
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledOnce();
    expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it('keeps cleanup failure primary and reconciles after correction integration rejects', async () => {
    const harness = makeHarness([
      {
        finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
    ]);
    vi.mocked(harness.dependencies.cleanRoom.integrateFix).mockResolvedValueOnce(
      err({ message: 'integration disconnected after attempting the merge' })
    );
    vi.mocked(harness.dependencies.execution.release).mockResolvedValueOnce(
      err({ message: 'execution release failed' })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cleanup-failed',
        stage: 'cleanup',
        featureHead: FEATURE_COMMIT,
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        pendingWorkspace: { cleanupId: 'cleanup-loop-verify-1' },
      },
    });
    expect(harness.dependencies.authority.inspectFeature).toHaveBeenCalledOnce();
    expect(vi.mocked(harness.dependencies.authority.inspectFeature).mock.calls[0]?.[0]).toEqual({
      target: featureTarget,
      expectedFeatureHead: FEATURE_COMMIT,
    });
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it('keeps bound destroy authority primary and reconciles after invalid integration success', async () => {
    const harness = makeHarness([
      {
        finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
    ]);
    const cleanupTarget: LoopSessionTarget = {
      workspaceId: 'loop-verify-1',
      path: '/tmp/loop-verify-1',
      machine: { kind: 'local' },
    };
    const create = vi.mocked(harness.dependencies.cleanRoom.create);
    const originalCreate = create.getMockImplementation()!;
    create.mockImplementationOnce(async (input) => {
      const created = await originalCreate(input);
      return created.success
        ? ok({
            ...created.data,
            target: cleanupTarget,
            branchName: 'emdash/loop-verify-1',
          })
        : created;
    });
    const pendingCleanup = makePendingCleanup(cleanupTarget);
    vi.mocked(harness.dependencies.cleanRoom.integrateFix).mockResolvedValueOnce(
      ok(undefined as never)
    );
    vi.mocked(harness.dependencies.cleanRoom.destroy).mockResolvedValueOnce(
      err({ message: 'destroy failed', pendingCleanup })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cleanup-failed',
        stage: 'cleanup',
        featureHead: FEATURE_COMMIT,
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        pendingCleanup: {
          cleanupId: 'cleanup-loop-verify-1',
          verificationRunId: 'verification-run-1',
        },
      },
    });
    expect(harness.dependencies.authority.inspectFeature).toHaveBeenCalledOnce();
    expect(vi.mocked(harness.dependencies.authority.inspectFeature).mock.calls[0]?.[0]).toEqual({
      target: featureTarget,
      expectedFeatureHead: FEATURE_COMMIT,
    });
  });

  it('retains a correctable required-check handoff before cleanup failure', async () => {
    const cleanTarget = cleanTargetFor(featureTarget);
    const harness = makeHarness([
      {
        finalText: 'Candidate green.\n<<<LOOP:E2E_PASSED>>>',
        checks: requiredChecksResult({
          target: cleanTarget,
          checkpointCommit: FEATURE_COMMIT,
          verificationRunId: 'verification-run-1',
          outerConversationId: 'e2e-conversation-1',
          taskEnvironment: environment(cleanTarget),
          status: 'correctable',
        }),
      },
    ]);
    vi.mocked(harness.dependencies.execution.release).mockResolvedValueOnce(
      err({ message: 'release failed after checks' })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cleanup-failed',
        stage: 'cleanup',
        intermediateFailures: [
          {
            source: 'Authoritative E2E checks',
            handoff: {
              summary: 'The native preview exposed a correctable dialog bug.',
            },
          },
        ],
      },
    });
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it('reserves worst-case outer and nested ledger capacity before creating a clean room', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const sessionAttempts = historicalAttempts(1_023);

    const result = await harness.gate.run({
      ...defaultInput,
      loop: loopWithState({ sessionAttempts }),
    });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'invalid-input', stage: 'precondition', attempt: 0 },
    });
    expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
  });

  it('rejects historical verification-run ID reuse before clean-room creation', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    if (!loop.state || loop.state.version !== '2') throw new Error('Expected Loop state fixture.');
    const historical = nestedAttempt({
      attemptId: 'historical-browser-attempt',
      conversationId: 'historical-browser-conversation',
      target: featureTarget,
      verificationRunId: 'verification-run-1',
    });
    const sessionAttempts = [...loop.state.sessionAttempts, historical];

    const result = await harness.gate.run({
      ...defaultInput,
      loop: loopWithState({ sessionAttempts }),
    });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'invalid-verification-run', stage: 'create', attempt: 1 },
    });
    expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
  });

  it('marks a deadline-stopped controlled prompt as interrupted in the append delta', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    type PromptResult = Awaited<
      ReturnType<CleanRoomE2EGateDependencies['session']['sendE2EPrompt']>
    >;
    const deferred = Promise.withResolvers<PromptResult>();
    vi.mocked(harness.dependencies.session.sendE2EPrompt).mockReturnValueOnce(deferred.promise);

    const run = harness.gate.run({ ...defaultInput, deadlineAt: Date.now() + 200 });
    await vi.waitFor(() =>
      expect(harness.dependencies.session.sendE2EPrompt).toHaveBeenCalledOnce()
    );
    const result = await run;
    deferred.resolve(err({ type: 'deadline-exceeded', message: 'prompt stopped' }));

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'deadline-exceeded',
        stage: 'prompt',
        lastWorkspaceDestroyed: true,
        sessionAttempts: [{ purpose: 'e2e', status: 'interrupted' }],
        stageResult: { status: 'interrupted' },
      },
    });
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledOnce();
    expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it('retains the expected and distinct actual terminal attempts from a quiesced rejection', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.requiredChecks.run).mockImplementationOnce(async (input) =>
      err({
        message: 'checks settled with terminal browser attempts',
        quiescent: true,
        sessionAttempts: [
          nestedAttempt({
            ...input.sessionIdentity,
            status: 'failed',
            error: 'native assertion failed',
          }),
          nestedAttempt({
            attemptId: 'unallocated-nested-attempt',
            conversationId: 'unallocated-nested-conversation',
            status: 'cancelled',
          }),
        ],
      })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        stage: 'required-checks',
        sessionAttempts: [
          { purpose: 'e2e', status: 'failed' },
          { attemptId: 'browser-verification-run-1', status: 'failed' },
          { attemptId: 'unallocated-nested-attempt', status: 'cancelled' },
        ],
      },
    });
    if (result.success) throw new Error('Expected required-check rejection.');
    expect(JSON.stringify(result)).toContain('unallocated-nested-attempt');
  });

  it('normalizes the expected and distinct actual nonterminal attempts after checks quiesce', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.requiredChecks.run).mockImplementationOnce(async (input) => {
      const running = nestedAttempt({ ...input.sessionIdentity, status: 'running' });
      const starting = nestedAttempt({
        attemptId: 'unallocated-nested-starting',
        conversationId: 'unallocated-nested-starting-conversation',
        status: 'starting',
      });
      delete running.finishedAt;
      delete starting.finishedAt;
      return err({
        message: 'checks quiesced while nested attempts were nonterminal',
        quiescent: true,
        sessionAttempts: [running, starting],
      });
    });

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        stage: 'required-checks',
        sessionAttempts: [
          { purpose: 'e2e', status: 'failed' },
          { attemptId: 'browser-verification-run-1', status: 'interrupted' },
          { attemptId: 'unallocated-nested-starting', status: 'interrupted' },
        ],
      },
    });
    if (result.success) throw new Error('Expected required-check rejection.');
    expect(result.error.sessionAttempts.slice(1).every((attempt) => attempt.finishedAt)).toBe(true);
  });

  it('passes a current retry checkpoint, state, ledger, and one canonical command list to checks', async () => {
    const normalizedValidationCommands = ['pnpm run test', 'pnpm run typecheck'];
    const retryLoop = loopWithConfig({ validationCommands: normalizedValidationCommands });
    const harness = makeHarness([
      {
        finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
      { finalText: 'Fresh pass.\n<<<LOOP:E2E_PASSED>>>' },
    ]);
    const checks = vi.mocked(harness.dependencies.requiredChecks.run);
    const originalChecks = checks.getMockImplementation()!;
    let received: Parameters<CleanRoomE2EGateDependencies['requiredChecks']['run']>[0] | undefined;
    checks.mockImplementationOnce(async (input) => {
      received = input;
      return originalChecks(input);
    });

    const result = await harness.gate.run({ ...defaultInput, loop: retryLoop });

    expect(result).toMatchObject({ success: true, data: { featureHead: FIX_COMMIT, attempts: 2 } });
    expect(received).toBeDefined();
    expect(received?.checkpointCommit).toBe(FIX_COMMIT);
    expect(received?.validationCommands).toEqual(normalizedValidationCommands);
    expect(received?.authority.progress.loopState).toMatchObject({
      expectedFeatureHead: FIX_COMMIT,
      checkpointCommit: FIX_COMMIT,
      verification: {
        verificationRunId: 'verification-run-2',
        attempt: 2,
        target: cleanTargetFor(featureTarget, 2),
        replayedThroughCommit: FIX_COMMIT,
        expectedFeatureHead: FIX_COMMIT,
      },
    });
    expect(received?.authority.progress.loopState.sessionAttempts.slice(-3)).toMatchObject([
      {
        attemptId: 'e2e-attempt-1',
        status: 'completed',
        checkpointAfter: FIX_COMMIT,
      },
      {
        attemptId: 'e2e-attempt-2',
        status: 'running',
        checkpointBefore: FIX_COMMIT,
      },
      {
        attemptId: 'browser-verification-run-2',
        status: 'starting',
        checkpointBefore: FIX_COMMIT,
      },
    ]);
  });

  it('rejects a trusted task environment with the wrong task name before session creation', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const acquire = vi.mocked(harness.dependencies.execution.acquire);
    const original = acquire.getMockImplementation()!;
    acquire.mockImplementationOnce(async (input) => {
      const result = await original(input);
      if (!result.success) return result;
      const taskEnvironment = {
        ...result.data.taskEnvironment,
        EMDASH_TASK_NAME: 'different task',
      };
      return ok({
        ...result.data,
        taskEnvironment,
        executionTarget: { ...result.data.executionTarget, taskEnv: taskEnvironment },
      });
    });

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'task-environment-invalid',
        stage: 'execution',
        lastWorkspaceDestroyed: true,
      },
    });
    expect(harness.dependencies.session.startFreshE2ESession).not.toHaveBeenCalled();
    expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it('redacts dependency secrets from every persisted failure string', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const secrets = ['loop-token-value', 'loop-password-value', 'loop-cookie-value'];
    vi.mocked(harness.dependencies.session.sendE2EPrompt).mockResolvedValueOnce(
      err({
        message:
          'token=loop-token-value password=loop-password-value session_cookie=loop-cookie-value',
      })
    );

    const result = await harness.gate.run(defaultInput);
    const persisted = JSON.stringify(result);

    expect(result).toMatchObject({ success: false, error: { stage: 'prompt' } });
    for (const secret of secrets) expect(persisted).not.toContain(secret);
    expect(persisted).toContain('[REDACTED');
  });

  it('redacts required-check secrets from persisted success summaries', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const secrets = ['summary-token-value', 'summary-password-value', 'summary-cookie-value'];
    mutateRequiredChecksOnce(harness, (result) => ({
      ...result,
      requiredTestsSummary: 'token=summary-token-value password=summary-password-value',
      nativePreview: {
        ...result.nativePreview,
        summary: 'session_cookie=summary-cookie-value',
      },
    }));

    const result = await harness.gate.run(defaultInput);
    const persisted = JSON.stringify(result);

    expect(result.success).toBe(true);
    for (const secret of secrets) expect(persisted).not.toContain(secret);
    expect(persisted).toContain('[REDACTED');
  });

  it('redacts sentinel and check-handoff secrets before retaining correction evidence', async () => {
    const secrets = ['sentinel-token-value', 'sentinel-cookie-value', 'handoff-password-value'];
    const harness = makeHarness([
      { finalText: 'unused' },
      {
        finalText:
          '<<<LOOP:E2E_CORRECTION_READY token=sentinel-token-value session_cookie=sentinel-cookie-value>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
      {
        finalText: 'Candidate green.\n<<<LOOP:E2E_PASSED>>>',
        checks: {
          ...requiredChecksResult({
            target: cleanTargetFor(featureTarget, 3),
            checkpointCommit: FIX_COMMIT,
            verificationRunId: 'verification-run-3',
            outerConversationId: 'e2e-conversation-3',
            taskEnvironment: environment(cleanTargetFor(featureTarget, 3)),
            attempt: 3,
            status: 'correctable',
          }),
          handoff: {
            source: 'Authoritative E2E checks',
            handoff: {
              summary: 'password=handoff-password-value',
              risks: ['session_cookie=sentinel-cookie-value'],
              remainingWork: ['token=sentinel-token-value'],
              artifacts: [],
              createdAt: '2026-07-12T01:01:30.000Z',
            },
          },
        },
      },
    ]);

    const result = await harness.gate.run({
      ...defaultInput,
      loop: loopWithState({ e2eAttemptsConsumed: 1 }),
    });
    const persisted = JSON.stringify(result);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'attempts-exhausted',
        intermediateFailures: [
          { source: 'Clean-room E2E correction' },
          { source: 'Authoritative E2E checks' },
        ],
      },
    });
    for (const secret of secrets) expect(persisted).not.toContain(secret);
    expect(persisted).toContain('[REDACTED');
  });

  it('contains a throwing nested clean-room success payload without losing recovery authority', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const hostileWorkspace = Object.defineProperty(
      {
        projectId: project.projectId,
        cleanupId: 'cleanup-loop-verify-1',
        verificationRunId: 'verification-run-1',
        attempt: 1,
      },
      'target',
      {
        enumerable: true,
        get: () => {
          throw new Error('hostile nested workspace target');
        },
      }
    );
    vi.mocked(harness.dependencies.cleanRoom.create).mockResolvedValueOnce(
      ok(hostileWorkspace as never)
    );

    const run = harness.gate.run(defaultInput);

    await expect(run).resolves.toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'create',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
      },
    });
    expect(harness.dependencies.execution.acquire).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it('contains a throwing nested execution-binding success payload without unsafe cleanup', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const hostileBinding = Object.defineProperty(
      {
        target: cleanTargetFor(featureTarget),
        taskEnvironment: environment(cleanTargetFor(featureTarget)),
      },
      'executionTarget',
      {
        enumerable: true,
        get: () => {
          throw new Error('hostile nested execution target');
        },
      }
    );
    vi.mocked(harness.dependencies.execution.acquire).mockResolvedValueOnce(
      ok(hostileBinding as never)
    );

    const run = harness.gate.run(defaultInput);

    await expect(run).resolves.toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'execution',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        pendingWorkspace: { cleanupId: 'cleanup-loop-verify-1' },
      },
    });
    expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it('contains a throwing nested cancellation success payload and retains the live workspace', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const target = cleanTargetFor(featureTarget);
    const hostileCancellation = Object.defineProperty(
      {
        attemptId: 'e2e-attempt-1',
        conversationId: 'e2e-conversation-1',
        purpose: 'e2e',
        phaseId: phase.id,
        verificationRunId: 'verification-run-1',
        attempt: 1,
        target,
      },
      'quiescent',
      {
        enumerable: true,
        get: () => {
          throw new Error('hostile nested quiescence flag');
        },
      }
    );
    vi.mocked(harness.dependencies.session.cancelE2ESession).mockResolvedValueOnce(
      ok(hostileCancellation as never)
    );

    const run = harness.gate.run(defaultInput);

    await expect(run).resolves.toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'quiescence',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
      },
    });
    expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it('cancels the preallocated identity when a stopped late start reports cleanup failure', async () => {
    const controller = new AbortController();
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    type StartResult = Awaited<
      ReturnType<CleanRoomE2EGateDependencies['session']['startFreshE2ESession']>
    >;
    const deferred = Promise.withResolvers<StartResult>();
    vi.mocked(harness.dependencies.session.startFreshE2ESession).mockReturnValueOnce(
      deferred.promise
    );

    const run = harness.gate.run({ ...defaultInput, signal: controller.signal });
    await vi.waitFor(() =>
      expect(harness.dependencies.session.startFreshE2ESession).toHaveBeenCalledOnce()
    );
    controller.abort();
    deferred.resolve(err({ type: 'cleanup-failed', message: 'late start may have created ACP' }));
    const result = await run;

    expect(result).toMatchObject({
      success: false,
      error: { type: 'cancelled', lastWorkspaceDestroyed: true },
    });
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'e2e-attempt-1',
        conversationId: 'e2e-conversation-1',
        verificationRunId: 'verification-run-1',
      })
    );
    expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it('forbids cleanup when a stopped late start cannot prove exact cancellation quiescence', async () => {
    const controller = new AbortController();
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    type StartResult = Awaited<
      ReturnType<CleanRoomE2EGateDependencies['session']['startFreshE2ESession']>
    >;
    const deferred = Promise.withResolvers<StartResult>();
    vi.mocked(harness.dependencies.session.startFreshE2ESession).mockReturnValueOnce(
      deferred.promise
    );
    vi.mocked(harness.dependencies.session.cancelE2ESession).mockImplementationOnce(async (input) =>
      ok({ ...input, conversationId: 'mismatched-cancellation', quiescent: true })
    );

    const run = harness.gate.run({ ...defaultInput, signal: controller.signal });
    await vi.waitFor(() =>
      expect(harness.dependencies.session.startFreshE2ESession).toHaveBeenCalledOnce()
    );
    controller.abort();
    deferred.resolve(err({ type: 'cleanup-failed', message: 'late start may have created ACP' }));
    const result = await run;

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'quiescence',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        pendingWorkspace: { cleanupId: 'cleanup-loop-verify-1' },
      },
    });
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledOnce();
    expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it('retains the live workspace when running progress and session cancellation both fail', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const progress = vi.mocked(harness.dependencies.progress.commit);
    const originalProgress = progress.getMockImplementation()!;
    progress.mockImplementation(async (input) => {
      if (
        input.transition.kind === 'session-attempt' &&
        input.transition.next.status === 'running'
      ) {
        return err({ message: 'running session progress CAS failed' });
      }
      return originalProgress(input);
    });
    vi.mocked(harness.dependencies.session.cancelE2ESession).mockResolvedValueOnce(
      err({ message: 'session remained live after progress failure' })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'quiescence',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        pendingWorkspace: { cleanupId: 'cleanup-loop-verify-1' },
      },
    });
    expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an unresolved verification workspace',
      loopWithState({
        verification: {
          verificationRunId: 'persisted-verification-run',
          attempt: 1,
          status: 'cleanup-failed',
          target: cleanTargetFor(featureTarget),
          baseCommit: BASE_COMMIT,
          replayedThroughCommit: FEATURE_COMMIT,
          expectedFeatureHead: FEATURE_COMMIT,
          cleanup: {
            status: 'failed',
            updatedAt: '2026-07-12T00:20:00.000Z',
            error: 'Workspace cleanup still requires recovery.',
          },
        },
      }),
    ],
    [
      'a persisted starting session',
      loopWithState({
        sessionAttempts: [
          ...(loop.state?.version === '2' ? loop.state.sessionAttempts : []),
          {
            attemptId: 'unresolved-starting-attempt',
            conversationId: 'unresolved-starting-conversation',
            purpose: 'e2e',
            phaseId: phase.id,
            verificationRunId: 'persisted-verification-run',
            target: cleanTargetFor(featureTarget),
            status: 'starting',
            checkpointBefore: FEATURE_COMMIT,
            startedAt: '2026-07-12T00:20:00.000Z',
          },
        ],
      }),
    ],
    [
      'a persisted running session',
      loopWithState({
        sessionAttempts: [
          ...(loop.state?.version === '2' ? loop.state.sessionAttempts : []),
          {
            attemptId: 'unresolved-running-attempt',
            conversationId: 'unresolved-running-conversation',
            purpose: 'browser-verification',
            phaseId: phase.id,
            verificationRunId: 'persisted-verification-run',
            target: cleanTargetFor(featureTarget),
            status: 'running',
            checkpointBefore: FEATURE_COMMIT,
            startedAt: '2026-07-12T00:20:00.000Z',
          },
        ],
      }),
    ],
  ] as const)('rejects %s before starting new durable work', async (_name, persistedLoop) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);

    const result = await harness.gate.run({ ...defaultInput, loop: persistedLoop });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'recovery-required', stage: 'precondition', attempt: 0 },
    });
    expect(harness.dependencies.progress.commit).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a terminal phase result',
      {
        version: '2',
        checkpointCommit: FEATURE_COMMIT,
        handoff: null,
        retryHandoffs: [],
        result: passedStage,
      },
      'phase-already-terminal',
    ],
    [
      'a stale phase checkpoint',
      {
        version: '2',
        checkpointCommit: BASE_COMMIT,
        handoff: null,
        retryHandoffs: [],
        result: null,
      },
      'phase-authority-invalid',
    ],
  ] as const)(
    'rejects %s instead of rerunning or overwriting it',
    async (_name, state, errorType) => {
      const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);

      const result = await harness.gate.run({
        ...defaultInput,
        phase: { ...phase, state: { ...state, retryHandoffs: [...state.retryHandoffs] } },
      });

      expect(result).toMatchObject({
        success: false,
        error: { type: errorType, stage: 'precondition', attempt: 0 },
      });
      expect(harness.dependencies.progress.commit).not.toHaveBeenCalled();
      expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
    }
  );

  it.each([
    { name: 'local', target: featureTarget, inputProject: project },
    {
      name: 'SSH',
      target: sshFeatureTarget,
      inputProject: {
        ...project,
        defaultWorkspaceMachine: sshFeatureTarget.machine,
      } as unknown as CleanRoomProject,
    },
  ] as const)('rejects a whitespace-normalized $name caller feature target', async (fixture) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }], fixture.target);

    const result = await harness.gate.run({
      ...defaultInput,
      project: fixture.inputProject,
      featureTarget: whitespaceAlias(fixture.target),
    });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'invalid-input', stage: 'precondition', attempt: 0 },
    });
    expect(harness.dependencies.progress.commit).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
  });

  it('persists and passes one preallocated nested browser identity before checks adopt it', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);

    const result = await harness.gate.run(defaultInput);

    expect(result.success).toBe(true);
    const checks = vi.mocked(harness.dependencies.requiredChecks.run);
    const checksInput = checks.mock.calls[0]?.[0] as unknown as {
      sessionIdentity?: { attemptId: string; conversationId: string };
    };
    expect(checksInput.sessionIdentity).toEqual({
      attemptId: 'browser-verification-run-1',
      conversationId: 'browser-conversation-run-1',
    });

    const progress = vi.mocked(harness.dependencies.progress.commit);
    const nestedProgressIndex = progress.mock.calls.findIndex(
      ([input]) =>
        input.transition.kind === 'session-attempt' &&
        input.transition.next.purpose === 'browser-verification' &&
        input.transition.next.status === 'starting'
    );
    expect(nestedProgressIndex).toBeGreaterThanOrEqual(0);
    expect(progress.mock.calls[nestedProgressIndex]?.[0]).toMatchObject({
      transition: {
        kind: 'session-attempt',
        next: {
          attemptId: 'browser-verification-run-1',
          conversationId: 'browser-conversation-run-1',
          purpose: 'browser-verification',
          status: 'starting',
        },
      },
    });
    expect(progress.mock.invocationCallOrder[nestedProgressIndex]).toBeLessThan(
      checks.mock.invocationCallOrder[0]!
    );
    if (!result.success) throw new Error('Expected a green E2E result.');
    expect(
      result.data.sessionAttempts.filter((attempt) => attempt.purpose === 'browser-verification')
    ).toEqual([
      expect.objectContaining({
        attemptId: 'browser-verification-run-1',
        conversationId: 'browser-conversation-run-1',
        status: 'completed',
      }),
    ]);
  });

  it('retains expected and actual nested attempts within the exact ledger capacity bound', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.requiredChecks.run).mockImplementationOnce(async (input) => {
      const authority = input as typeof input & {
        sessionIdentity?: { attemptId: string; conversationId: string };
      };
      const exactIdentity = authority.sessionIdentity ?? {
        attemptId: 'browser-verification-run-1',
        conversationId: 'browser-conversation-run-1',
      };
      return err({
        message: 'checks rejected after nested verification',
        quiescent: true,
        sessionAttempts: [
          nestedAttempt(exactIdentity),
          nestedAttempt({
            attemptId: 'unallocated-browser-attempt',
            conversationId: 'unallocated-browser-conversation',
            phaseId: input.authority.phaseId,
            verificationRunId: input.verificationRunId,
            target: input.target,
            checkpointBefore: input.checkpointCommit,
            checkpointAfter: input.checkpointCommit,
          }),
        ],
      });
    });

    const result = await harness.gate.run({
      ...defaultInput,
      loop: loopWithState({
        e2eAttemptsConsumed: 2,
        sessionAttempts: [...historicalAttempts(1_017), ...loop.state!.sessionAttempts],
      }),
    });

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'required-checks',
      },
    });
    if (result.success) throw new Error('Expected rejected required checks.');
    expect(
      result.error.sessionAttempts.filter((attempt) => attempt.purpose === 'browser-verification')
    ).toEqual([
      expect.objectContaining({
        attemptId: 'browser-verification-run-3',
        conversationId: 'browser-conversation-run-3',
      }),
      expect.objectContaining({
        attemptId: 'unallocated-browser-attempt',
        conversationId: 'unallocated-browser-conversation',
      }),
    ]);
    expect(JSON.stringify(result)).toContain('unallocated-browser-attempt');
    expect(harness.dependencies.cleanRoom.create).toHaveBeenCalledOnce();
  }, 15_000);

  it('durably retains a mismatched fresh session identity that was actually created', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const start = vi.mocked(harness.dependencies.session.startFreshE2ESession);
    const originalStart = start.getMockImplementation()!;
    start.mockImplementationOnce(async (input) => {
      const started = await originalStart(input);
      if (!started.success) return started;
      return ok({
        ...started.data,
        attemptId: 'actual-fresh-attempt',
        conversationId: 'actual-fresh-conversation',
      });
    });

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'session-authority-invalid',
        stage: 'session-start',
        lastWorkspaceDestroyed: true,
        sessionAttempts: expect.arrayContaining([
          expect.objectContaining({
            attemptId: 'actual-fresh-attempt',
            conversationId: 'actual-fresh-conversation',
            status: expect.stringMatching(/^(?:failed|cancelled|interrupted)$/),
          }),
        ]),
      },
    });
    expect(
      vi
        .mocked(harness.dependencies.progress.commit)
        .mock.calls.some(
          ([input]) =>
            input.transition.kind === 'session-attempt' &&
            input.transition.next.attemptId === 'actual-fresh-attempt'
        )
    ).toBe(true);
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'actual-fresh-attempt',
        conversationId: 'actual-fresh-conversation',
      })
    );
  });

  it('does not persist a valid correction SHA before uncontrolled feature attestation', async () => {
    const unattestedCommit = '4'.repeat(40);
    const harness = makeHarness([
      {
        finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
    ]);
    vi.mocked(harness.dependencies.cleanRoom.integrateFix).mockResolvedValueOnce(
      ok({ featureHead: unattestedCommit })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: expect.stringMatching(/^(?:integration-authority-invalid|feature-head-drift)$/),
        recoveryRequired: true,
      },
    });
    expect(
      vi
        .mocked(harness.dependencies.progress.commit)
        .mock.calls.some(([input]) => input.transition.kind === 'checkpoint-advanced')
    ).toBe(false);
  });

  it('atomically advances the phase checkpoint with every retained retry handoff', async () => {
    const priorFailure = {
      source: 'Prior E2E failure',
      handoff: {
        summary: 'A prior clean-room attempt found a separate issue.',
        risks: ['The prior issue must remain visible across retries.'],
        remainingWork: ['Retain this evidence while applying the next correction.'],
        artifacts: [],
        createdAt: '2026-07-12T00:45:00.000Z',
      },
    };
    const harness = makeHarness([
      {
        finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
      { finalText: '<<<LOOP:E2E_PASSED>>>' },
    ]);

    const result = await harness.gate.run({
      ...defaultInput,
      phase: {
        ...phase,
        state: {
          version: '2',
          checkpointCommit: FEATURE_COMMIT,
          handoff: null,
          retryHandoffs: [priorFailure],
          result: null,
        },
      },
      intermediateFailures: [priorFailure],
    });

    expect(result.success).toBe(true);
    const progress = vi.mocked(harness.dependencies.progress.commit);
    const checkpointCall = progress.mock.calls.find(
      ([input]) => input.transition.kind === 'checkpoint-advanced'
    )?.[0];
    expect(checkpointCall).toMatchObject({
      transition: {
        kind: 'checkpoint-advanced',
        previousHead: FEATURE_COMMIT,
        featureHead: FIX_COMMIT,
        retryHandoffs: [{ source: 'Prior E2E failure' }, { source: 'Clean-room E2E correction' }],
      },
    });
    const checksInput = vi.mocked(harness.dependencies.requiredChecks.run).mock.calls[0]?.[0];
    expect(checksInput?.authority.progress.phaseState).toMatchObject({
      version: '2',
      checkpointCommit: FIX_COMMIT,
      retryHandoffs: [{ source: 'Prior E2E failure' }, { source: 'Clean-room E2E correction' }],
      result: null,
    });
  });

  it.each([
    [
      'attempt ID',
      'token=nested-attempt-secret',
      (attempt: LoopSessionAttempt): LoopSessionAttempt => ({
        ...attempt,
        attemptId: 'token=nested-attempt-secret',
      }),
    ],
    [
      'conversation ID',
      'password=nested-conversation-secret',
      (attempt: LoopSessionAttempt): LoopSessionAttempt => ({
        ...attempt,
        conversationId: 'password=nested-conversation-secret',
      }),
    ],
    [
      'start timestamp',
      'cookie=nested-start-secret',
      (attempt: LoopSessionAttempt): LoopSessionAttempt => ({
        ...attempt,
        startedAt: 'cookie=nested-start-secret',
      }),
    ],
    [
      'finish timestamp',
      'token=nested-finish-secret',
      (attempt: LoopSessionAttempt): LoopSessionAttempt => ({
        ...attempt,
        finishedAt: 'token=nested-finish-secret',
      }),
    ],
  ] as const)(
    'rejects a secret-bearing nested browser %s before durable retention',
    async (_name, secret, mutate) => {
      const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
      mutateRequiredChecksOnce(harness, (checks) => ({
        ...checks,
        sessionAttempts: [mutate(checks.sessionAttempts[0]!)],
      }));

      const result = await harness.gate.run(defaultInput);

      expect(result).toMatchObject({
        success: false,
        error: { type: 'native-verifier-ledger-invalid', stage: 'required-checks' },
      });
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  );

  it.each([
    ['handoff timestamp', true],
    ['artifact timestamp', false],
  ] as const)(
    'rejects a secret-bearing correctable-check %s before retaining the handoff',
    async (_name, poisonHandoffTimestamp) => {
      const secret = poisonHandoffTimestamp
        ? 'token=handoff-timestamp-secret'
        : 'cookie=artifact-timestamp-secret';
      const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
      mutateRequiredChecksOnce(harness, (checks) => ({
        ...checks,
        status: 'correctable',
        nativePreview: { ...checks.nativePreview, passed: false },
        handoff: {
          source: 'Authoritative E2E checks',
          handoff: {
            summary: 'The browser found one correctable issue.',
            risks: [],
            remainingWork: ['Correct the issue and retry in a fresh workspace.'],
            artifacts: [
              {
                artifactId: 'browser-diagnostics',
                kind: 'browser-diagnostics',
                byteLength: 128,
                createdAt: poisonHandoffTimestamp ? '2026-07-12T01:01:30.000Z' : secret,
              },
            ],
            createdAt: poisonHandoffTimestamp ? secret : '2026-07-12T01:01:30.000Z',
          },
        },
      }));

      const result = await harness.gate.run(defaultInput);

      expect(result).toMatchObject({
        success: false,
        error: { type: 'unsafe-correction-handoff', stage: 'required-checks' },
      });
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  );

  it('fails before resource creation when the initial progress CAS rejects', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.progress.commit).mockResolvedValueOnce(
      err({ message: 'progress store unavailable' })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'progress-authority-invalid',
        stage: 'progress',
        attempt: 1,
        recoveryRequired: true,
      },
    });
    expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
  });

  it('fails before resource creation when progress persistence returns drifted authority', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.progress.commit).mockImplementationOnce(async (input) =>
      ok(input.expected)
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { type: 'progress-authority-invalid', stage: 'progress', attempt: 1 },
    });
    expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
  });

  it('returns a typed terminal-progress failure only after all live resources are cleaned', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const progress = vi.mocked(harness.dependencies.progress.commit);
    const originalProgress = progress.getMockImplementation()!;
    progress.mockImplementation(async (input) =>
      input.transition.kind === 'terminal'
        ? err({ message: 'terminal progress CAS failed' })
        : originalProgress(input)
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { type: 'dependency-rejected', stage: 'progress' },
    });
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledOnce();
    expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it('retries uncontrolled feature reconciliation when the first post-integration read fails', async () => {
    const harness = makeHarness([
      {
        finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
    ]);
    vi.mocked(harness.dependencies.authority.inspectFeature)
      .mockRejectedValueOnce(new Error('first uncontrolled inspection disconnected'))
      .mockResolvedValueOnce(
        ok({
          target: featureTarget,
          headCommit: FIX_COMMIT,
          clean: true,
          branchAttached: true,
        })
      );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { type: 'dependency-rejected', stage: 'correction', featureHead: FIX_COMMIT },
    });
    expect(harness.dependencies.authority.inspectFeature).toHaveBeenCalledTimes(2);
  });
});
