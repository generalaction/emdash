import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@main/lib/result';
import type { CleanRoomProject } from '../clean-room/clean-room-workspace-service';
import type { CleanRoomPendingCleanup } from '../clean-room/cleanup-journal';
import type {
  CleanRoomE2EGateDependencies,
  E2ERequiredChecksResult,
  RunCleanRoomE2EGateInput,
} from './clean-room-e2e-gate';
import {
  BASE_COMMIT,
  FEATURE_COMMIT,
  FIX_COMMIT,
  defaultInput,
  environment,
  featureTarget,
  loop,
  loopWithConfig,
  loopWithState,
  loopWithTerminalGates,
  makeHarness,
  mutateRequiredChecksOnce,
  phase,
  project,
  requiredChecksResult,
  sshFeatureTarget,
  type Harness,
} from './clean-room-e2e-gate.test-harness';

describe('CleanRoomE2EGate', () => {
  it('returns first-pass success only after checks, release, destroy, and feature inspection', async () => {
    const harness = makeHarness([{ finalText: 'Green.\n<<<LOOP:E2E_PASSED>>>' }]);

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: true,
      data: {
        purpose: 'e2e',
        previousFeatureHead: FEATURE_COMMIT,
        featureHead: FEATURE_COMMIT,
        attempts: 1,
        correctionCount: 0,
        lastWorkspaceDestroyed: true,
        requiredTestsSummary: 'Full checks passed.',
        nativePreviewSummary: 'Native preview passed.',
        stageResult: { status: 'passed', completedAt: '2026-07-12T01:04:00.000Z' },
      },
    });
    expect(harness.calls).toEqual([
      `create:1:${FEATURE_COMMIT}`,
      'acquire:1',
      'begin:1',
      'start:1',
      'prompt:1',
      'cancel:1',
      'inspect:1:prompt',
      'checks:1',
      'inspect:1:checks',
      'release:1',
      'destroy:1',
      `feature:1:${FEATURE_COMMIT}`,
    ]);
  });

  it('integrates one correction, destroys it, and passes only in a fresh recreated attempt', async () => {
    const harness = makeHarness([
      {
        finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY dialog state>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
      { finalText: 'Fresh replay is green.\n<<<LOOP:E2E_PASSED>>>' },
    ]);

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: true,
      data: {
        previousFeatureHead: FEATURE_COMMIT,
        featureHead: FIX_COMMIT,
        attempts: 2,
        correctionCount: 1,
        lastWorkspaceDestroyed: true,
        intermediateFailures: [{ source: 'Clean-room E2E correction' }],
      },
    });
    expect(harness.calls).toContain(`integrate:1:${FIX_COMMIT}`);
    expect(harness.calls.indexOf('destroy:1')).toBeLessThan(
      harness.calls.indexOf(`create:2:${FIX_COMMIT}`)
    );
    expect(harness.calls.filter((call) => call.startsWith('checks:'))).toEqual(['checks:2']);
  });

  it('recreates after a bounded correctable check handoff, then accepts a fix and fresh pass', async () => {
    const firstTarget = {
      workspaceId: 'verification-workspace-1',
      path: '/tmp/verification-workspace-1',
      machine: { kind: 'local' as const },
    };
    const harness = makeHarness([
      {
        finalText: 'Candidate green.\n<<<LOOP:E2E_PASSED>>>',
        checks: requiredChecksResult({
          target: firstTarget,
          checkpointCommit: FEATURE_COMMIT,
          verificationRunId: 'verification-run-1',
          outerConversationId: 'e2e-conversation-1',
          taskEnvironment: environment(firstTarget),
          status: 'correctable',
        }),
      },
      {
        finalText: 'Applied the check finding.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
      { finalText: 'Fresh result green.\n<<<LOOP:E2E_PASSED>>>' },
    ]);

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: true,
      data: {
        attempts: 3,
        correctionCount: 1,
        featureHead: FIX_COMMIT,
        intermediateFailures: [
          { source: 'Authoritative E2E checks' },
          { source: 'Clean-room E2E correction' },
        ],
      },
    });
    const secondPrompt = vi.mocked(harness.dependencies.session.sendE2EPrompt).mock.calls[1]?.[0]
      .prompt;
    expect(secondPrompt).toContain('native preview exposed a correctable dialog bug');
    const failureData = secondPrompt?.match(
      /<emdash-loop-failure-data>\n([\s\S]*?)\n<\/emdash-loop-failure-data>/
    )?.[1];
    expect(failureData).not.toContain('/tmp');
    expect(harness.calls.indexOf('destroy:1')).toBeLessThan(
      harness.calls.indexOf(`create:2:${FEATURE_COMMIT}`)
    );
  });

  it('never treats a correction as pass when the attempt cap is exhausted', async () => {
    const harness = makeHarness([
      { finalText: 'unused' },
      { finalText: 'unused' },
      {
        finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
    ]);

    const result = await harness.gate.run({
      ...defaultInput,
      loop: loopWithState({ e2eAttemptsConsumed: 2 }),
    });

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'attempts-exhausted',
        featureHead: FIX_COMMIT,
        attempt: 3,
        intermediateFailures: [{ source: 'Clean-room E2E correction' }],
        stageResult: { status: 'failed' },
      },
    });
    expect(harness.calls).not.toContain('checks:3');
    expect(harness.calls).toContain('destroy:3');
    expect(harness.dependencies.authority.inspectFeature).toHaveBeenCalledTimes(2);
    expect(vi.mocked(harness.dependencies.authority.inspectFeature).mock.calls).toEqual([
      [{ target: featureTarget, expectedFeatureHead: FIX_COMMIT }],
      [{ target: featureTarget, expectedFeatureHead: FIX_COMMIT }],
    ]);
  });

  it.each([
    [{ review: false, e2e: false }, 'e2e-disabled'],
    [{ review: true, e2e: false }, 'e2e-disabled'],
  ] as const)('rejects a disabled E2E terminal gate', async (terminalGates, type) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);

    const result = await harness.gate.run({
      ...defaultInput,
      loop: loopWithTerminalGates(terminalGates),
      terminalGates,
    });

    expect(result).toMatchObject({ success: false, error: { type, stage: 'precondition' } });
    expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
  });

  it('accepts E2E-only ordering when Review is disabled and no Review result exists', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);

    const result = await harness.gate.run({
      ...defaultInput,
      loop: loopWithTerminalGates({ review: false, e2e: true }),
      terminalGates: { review: false, e2e: true },
    });

    expect(result).toMatchObject({
      success: true,
      data: { purpose: 'e2e', featureHead: FEATURE_COMMIT, attempts: 1 },
    });
  });

  it('retains an exact SSH machine through every port without local fallback', async () => {
    const sshProject = {
      ...project,
      defaultWorkspaceMachine: sshFeatureTarget.machine,
    } as unknown as CleanRoomProject;
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }], sshFeatureTarget);

    const result = await harness.gate.run({
      ...defaultInput,
      project: sshProject,
      featureTarget: sshFeatureTarget,
    });

    expect(result.success).toBe(true);
    const start = vi.mocked(harness.dependencies.session.startFreshE2ESession).mock.calls[0]?.[0];
    expect(start?.target.machine).toEqual(sshFeatureTarget.machine);
    const checks = vi.mocked(harness.dependencies.requiredChecks.run).mock.calls[0]?.[0];
    expect(checks?.target.machine).toEqual(sshFeatureTarget.machine);
    expect(checks?.executionTarget.machine).toEqual(sshFeatureTarget.machine);
  });

  it('cancels a late successful session start after abort without sending a prompt', async () => {
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
    const target = {
      workspaceId: 'verification-workspace-1',
      path: '/tmp/verification-workspace-1',
      machine: { kind: 'local' as const },
    };
    deferred.resolve(
      ok({
        attemptId: 'e2e-attempt-1',
        conversationId: 'e2e-conversation-1',
        purpose: 'e2e',
        phaseId: phase.id,
        verificationRunId: 'verification-run-1',
        attempt: 1,
        target,
        provider: 'codex',
        model: 'gpt-5.6-sol',
        taskEnvironment: environment(target),
      })
    );

    const result = await run;

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cancelled',
        featureHead: FEATURE_COMMIT,
        lastWorkspaceDestroyed: true,
        sessionAttempts: [{ conversationId: 'e2e-conversation-1' }],
      },
    });
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledOnce();
    expect(harness.dependencies.session.sendE2EPrompt).not.toHaveBeenCalled();
    expect(harness.calls).toContain('release:1');
    expect(harness.calls).toContain('destroy:1');
  });

  it('turns a thrown prompt dependency into a typed failure after quiescent cleanup', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.session.sendE2EPrompt).mockImplementationOnce(async () => {
      throw new Error('prompt transport exploded');
    });

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'prompt',
        lastWorkspaceDestroyed: true,
      },
    });
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledOnce();
    expect(harness.calls).toContain('release:1');
    expect(harness.calls).toContain('destroy:1');
  });

  it('rejects an unknown required-check status instead of falling through to pass', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const checks = vi.mocked(harness.dependencies.requiredChecks.run);
    const original = checks.getMockImplementation()!;
    checks.mockImplementationOnce(async (input) => {
      const result = await original(input);
      if (!result.success) return result;
      return ok({ ...result.data, status: 'unknown' } as unknown as E2ERequiredChecksResult);
    });

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { type: 'required-checks-authority-invalid', stage: 'required-checks' },
    });
    expect(harness.calls).toContain('release:1');
    expect(harness.calls).toContain('destroy:1');
  });

  it('rejects a non-terminal or previously used nested browser session ledger', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const checks = vi.mocked(harness.dependencies.requiredChecks.run);
    const original = checks.getMockImplementation()!;
    checks.mockImplementationOnce(async (input) => {
      const result = await original(input);
      if (!result.success) return result;
      return ok({
        ...result.data,
        sessionAttempts: [
          {
            ...result.data.sessionAttempts[0]!,
            conversationId: 'work-1',
            status: 'running' as const,
            finishedAt: undefined,
          },
        ],
      });
    });

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'native-verifier-ledger-ambiguous',
        stage: 'required-checks',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
      },
    });
    expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it('requires exactly one exact completed nested browser session attestation', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const checks = vi.mocked(harness.dependencies.requiredChecks.run);
    const original = checks.getMockImplementation()!;
    checks.mockImplementationOnce(async (input) => {
      const result = await original(input);
      if (!result.success) return result;
      const first = result.data.sessionAttempts[0]!;
      return ok({
        ...result.data,
        sessionAttempts: [
          first,
          {
            ...first,
            attemptId: 'browser-second',
            conversationId: 'browser-second-conversation',
          },
        ],
      });
    });

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { type: 'native-verifier-ledger-invalid', stage: 'required-checks' },
    });
  });

  it('cleans up and reports recovery authority when integration returns an invalid head', async () => {
    const harness = makeHarness([
      {
        finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
    ]);
    vi.mocked(harness.dependencies.cleanRoom.integrateFix).mockResolvedValueOnce(
      ok({ featureHead: 'not-a-commit' })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'integration-authority-invalid',
        recoveryRequired: true,
        lastWorkspaceDestroyed: true,
      },
    });
    expect(harness.calls).toContain('release:1');
    expect(harness.calls).toContain('destroy:1');
  });

  it('retains a failed ledger entry for a created session whose target attestation is invalid', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const start = vi.mocked(harness.dependencies.session.startFreshE2ESession);
    const original = start.getMockImplementation()!;
    start.mockImplementationOnce(async (input) => {
      const result = await original(input);
      if (!result.success) return result;
      return ok({
        ...result.data,
        target: { ...result.data.target, workspaceId: 'wrong-verification-workspace' },
      });
    });

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'session-authority-invalid',
        conversationId: 'e2e-conversation-1',
        lastWorkspaceDestroyed: true,
        sessionAttempts: [
          {
            attemptId: 'e2e-attempt-1',
            conversationId: 'e2e-conversation-1',
            target: {
              workspaceId: 'verification-workspace-1',
              path: '/tmp/verification-workspace-1',
              machine: { kind: 'local' },
            },
            status: 'failed',
          },
        ],
      },
    });
    if (result.success) throw new Error('Expected invalid session authority.');
    expect(result.error.sessionAttempts[0]?.target.workspaceId).not.toBe(
      'wrong-verification-workspace'
    );
  });

  it('retains invalid-session cleanup authority when cancellation cannot prove quiescence', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const start = vi.mocked(harness.dependencies.session.startFreshE2ESession);
    const original = start.getMockImplementation()!;
    start.mockImplementationOnce(async (input) => {
      const result = await original(input);
      if (!result.success) return result;
      return ok({
        ...result.data,
        target: { ...result.data.target, workspaceId: 'wrong-verification-workspace' },
      });
    });
    vi.mocked(harness.dependencies.session.cancelE2ESession).mockResolvedValueOnce(
      err({ message: 'session remained live' })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'quiescence',
        conversationId: 'e2e-conversation-1',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        pendingWorkspace: {
          projectId: project.projectId,
          cleanupId: 'cleanup-loop-verify-1',
          verificationRunId: 'verification-run-1',
          attempt: 1,
          target: {
            workspaceId: 'verification-workspace-1',
            path: '/tmp/verification-workspace-1',
          },
          expectedFeatureHead: FEATURE_COMMIT,
        },
        sessionAttempts: [{ conversationId: 'e2e-conversation-1', status: 'interrupted' }],
      },
    });
    expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it('rejects an oversized trusted task-environment value before session creation', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const acquire = vi.mocked(harness.dependencies.execution.acquire);
    const original = acquire.getMockImplementation()!;
    acquire.mockImplementationOnce(async (input) => {
      const result = await original(input);
      if (!result.success) return result;
      const taskEnvironment = {
        ...result.data.taskEnvironment,
        EMDASH_TASK_NAME: 'x'.repeat(65_537),
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
      error: { type: 'task-environment-invalid', stage: 'execution' },
    });
    expect(harness.dependencies.session.startFreshE2ESession).not.toHaveBeenCalled();
  });

  it('uses an uncontrolled final feature inspection after cleanup even when destroy aborts', async () => {
    const controller = new AbortController();
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const destroy = vi.mocked(harness.dependencies.cleanRoom.destroy);
    const original = destroy.getMockImplementation()!;
    destroy.mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      controller.abort();
      return result;
    });

    const result = await harness.gate.run({ ...defaultInput, signal: controller.signal });

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cancelled',
        featureHead: FEATURE_COMMIT,
        lastWorkspaceDestroyed: true,
      },
    });
    const finalInspect = vi.mocked(harness.dependencies.authority.inspectFeature).mock
      .calls[0]?.[0];
    expect(finalInspect?.signal).toBeUndefined();
    expect(finalInspect?.deadlineAt).toBeUndefined();
  });

  it('rejects a clean room that reuses the feature target instead of a disposable workspace', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.cleanRoom.create).mockImplementationOnce(async (input) =>
      ok({
        projectId: project.projectId,
        cleanupId: 'cleanup-feature-reuse',
        verificationRunId: input.verificationRunId,
        attempt: input.attempt,
        target: featureTarget,
        branchName: 'emdash/feature-reuse',
        baseCommit: input.baseCommit,
        expectedFeatureHead: input.expectedFeatureHead,
        replayedThroughCommit: input.expectedFeatureHead,
      })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'target-drift',
        stage: 'create',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
      },
    });
    expect(harness.dependencies.execution.acquire).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it.each([
    ['a descendant of the feature workspace', `${featureTarget.path}/verification-child`],
    ['an ancestor of the feature workspace', '/tmp'],
    ['a descendant of the project repository', `${project.repoPath}/verification-child`],
  ] as const)('rejects a clean room at %s', async (_name, overlappingPath) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.cleanRoom.create).mockImplementationOnce(async (input) =>
      ok({
        projectId: project.projectId,
        cleanupId: 'cleanup-overlapping-target',
        verificationRunId: input.verificationRunId,
        attempt: input.attempt,
        target: {
          workspaceId: 'overlapping-verification-workspace',
          path: overlappingPath,
          machine: { ...featureTarget.machine },
        },
        branchName: 'emdash/overlapping-verification-workspace',
        baseCommit: input.baseCommit,
        expectedFeatureHead: input.expectedFeatureHead,
        replayedThroughCommit: input.expectedFeatureHead,
      })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'target-drift',
        stage: 'create',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
      },
    });
    expect(harness.dependencies.execution.acquire).not.toHaveBeenCalled();
    expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it.each([
    [
      'running status',
      (result: E2ERequiredChecksResult) => ({
        ...result,
        sessionAttempts: [
          { ...result.sessionAttempts[0]!, status: 'running' as const, finishedAt: undefined },
        ],
      }),
    ],
    [
      'missing finished timestamp',
      (result: E2ERequiredChecksResult) => {
        const { finishedAt: _finishedAt, ...attempt } = result.sessionAttempts[0]!;
        return { ...result, sessionAttempts: [attempt] };
      },
    ],
    [
      'wrong phase',
      (result: E2ERequiredChecksResult) => ({
        ...result,
        sessionAttempts: [{ ...result.sessionAttempts[0]!, phaseId: 'different-phase' }],
      }),
    ],
    [
      'wrong checkpoint before',
      (result: E2ERequiredChecksResult) => ({
        ...result,
        sessionAttempts: [{ ...result.sessionAttempts[0]!, checkpointBefore: BASE_COMMIT }],
      }),
    ],
    [
      'wrong checkpoint after',
      (result: E2ERequiredChecksResult) => ({
        ...result,
        sessionAttempts: [{ ...result.sessionAttempts[0]!, checkpointAfter: BASE_COMMIT }],
      }),
    ],
    [
      'previous conversation reuse',
      (result: E2ERequiredChecksResult) => ({
        ...result,
        sessionAttempts: [{ ...result.sessionAttempts[0]!, conversationId: 'work-1' }],
      }),
    ],
    [
      'outer attempt identity reuse',
      (result: E2ERequiredChecksResult) => ({
        ...result,
        sessionAttempts: [{ ...result.sessionAttempts[0]!, attemptId: 'e2e-attempt-1' }],
      }),
    ],
  ] as const)('rejects nested browser ledger authority with %s', async (name, mutate) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    mutateRequiredChecksOnce(harness, mutate);

    const result = await harness.gate.run(defaultInput);
    const collidesWithDurableIdentity =
      name === 'previous conversation reuse' || name === 'outer attempt identity reuse';

    expect(result).toMatchObject({
      success: false,
      error: {
        type: collidesWithDurableIdentity
          ? 'native-verifier-ledger-ambiguous'
          : 'native-verifier-ledger-invalid',
        stage: 'required-checks',
        ...(collidesWithDurableIdentity
          ? { recoveryRequired: true, lastWorkspaceDestroyed: false }
          : {}),
      },
    });
    if (collidesWithDurableIdentity) {
      expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
      expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
    } else {
      expect(harness.calls).toContain('release:1');
      expect(harness.calls).toContain('destroy:1');
    }
    expect(harness.dependencies.authority.inspectFeature).not.toHaveBeenCalled();
  });

  it('rejects concealed mutation after a pass candidate before running required checks', async () => {
    const harness = makeHarness([
      { finalText: '<<<LOOP:E2E_PASSED>>>', postHead: FEATURE_COMMIT, mutated: true },
    ]);

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { type: 'mutation-concealed', stage: 'inspect' },
    });
    expect(harness.dependencies.requiredChecks.run).not.toHaveBeenCalled();
    expect(harness.calls).toContain('release:1');
    expect(harness.calls).toContain('destroy:1');
  });

  it('rejects concealed mutation introduced by required checks', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const inspect = vi.mocked(harness.dependencies.authority.inspectAttempt);
    const original = inspect.getMockImplementation()!;
    inspect.mockImplementationOnce(original).mockImplementationOnce(async (input) => {
      const result = await original(input);
      return result.success ? ok({ ...result.data, mutated: true }) : result;
    });

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'post-check-drift',
        stage: 'finalize',
        sessionAttempts: [
          { purpose: 'e2e', status: 'failed' },
          { purpose: 'browser-verification', status: 'completed' },
        ],
      },
    });
    expect(harness.calls).toContain('release:1');
    expect(harness.calls).toContain('destroy:1');
    expect(harness.dependencies.authority.inspectFeature).not.toHaveBeenCalled();
  });

  it('rejects a trusted task-environment value over the per-value bound', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const acquire = vi.mocked(harness.dependencies.execution.acquire);
    const original = acquire.getMockImplementation()!;
    acquire.mockImplementationOnce(async (input) => {
      const result = await original(input);
      if (!result.success) return result;
      const taskEnvironment = {
        ...result.data.taskEnvironment,
        EMDASH_TASK_NAME: 'x'.repeat(4_097),
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
      error: { type: 'task-environment-invalid', stage: 'execution' },
    });
    expect(harness.dependencies.session.startFreshE2ESession).not.toHaveBeenCalled();
  });

  it('cancels a held prompt immediately on abort without waiting for prompt settlement', async () => {
    const controller = new AbortController();
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    type PromptResult = Awaited<
      ReturnType<CleanRoomE2EGateDependencies['session']['sendE2EPrompt']>
    >;
    const deferred = Promise.withResolvers<PromptResult>();
    vi.mocked(harness.dependencies.session.sendE2EPrompt).mockReturnValueOnce(deferred.promise);

    const run = harness.gate.run({ ...defaultInput, signal: controller.signal });
    await vi.waitFor(() =>
      expect(harness.dependencies.session.sendE2EPrompt).toHaveBeenCalledOnce()
    );
    controller.abort();
    await vi.waitFor(() =>
      expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledOnce()
    );

    const result = await run;
    deferred.resolve(err({ type: 'cancelled', message: 'prompt stopped' }));

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cancelled',
        stage: 'prompt',
        lastWorkspaceDestroyed: true,
        sessionAttempts: [{ purpose: 'e2e', status: 'cancelled' }],
        stageResult: { status: 'cancelled' },
      },
    });
    expect(harness.dependencies.requiredChecks.run).not.toHaveBeenCalled();
    expect(harness.calls).toContain('release:1');
    expect(harness.calls).toContain('destroy:1');
  });

  it('waits for held required checks to settle before cleaning up after abort', async () => {
    const controller = new AbortController();
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    type ChecksResult = Awaited<ReturnType<CleanRoomE2EGateDependencies['requiredChecks']['run']>>;
    const deferred = Promise.withResolvers<ChecksResult>();
    vi.mocked(harness.dependencies.requiredChecks.run).mockReturnValueOnce(deferred.promise);
    let settled = false;
    const run = harness.gate.run({ ...defaultInput, signal: controller.signal }).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(harness.dependencies.requiredChecks.run).toHaveBeenCalledOnce());
    controller.abort();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    expect(harness.dependencies.execution.release).not.toHaveBeenCalled();

    deferred.resolve(err({ type: 'cancelled', message: 'checks stopped', quiescent: true }));
    const result = await run;

    expect(result).toMatchObject({
      success: false,
      error: { type: 'cancelled', stage: 'required-checks', lastWorkspaceDestroyed: true },
    });
    expect(harness.calls).toContain('release:1');
    expect(harness.calls).toContain('destroy:1');
  });

  it('lets release failure override a thrown prompt and forbids destroy', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.session.sendE2EPrompt).mockRejectedValueOnce(
      new Error('prompt transport exploded')
    );
    vi.mocked(harness.dependencies.execution.release).mockResolvedValueOnce(
      err({ type: 'cleanup-failed', message: 'execution remained acquired' })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cleanup-failed',
        stage: 'cleanup',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
      },
    });
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it('preserves pending cleanup when destroy failure overrides a green candidate', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const create = vi.mocked(harness.dependencies.cleanRoom.create);
    const originalCreate = create.getMockImplementation()!;
    create.mockImplementationOnce(async (input) => {
      const created = await originalCreate(input);
      if (!created.success) return created;
      const target = {
        workspaceId: 'loop-verify-1',
        path: '/tmp/loop-verify-1',
        machine: { kind: 'local' as const },
      };
      return ok({
        ...created.data,
        target,
        branchName: 'emdash/loop-verify-1',
      });
    });
    const pendingCleanup: CleanRoomPendingCleanup = {
      version: '1' as const,
      cleanupId: 'cleanup-loop-verify-1',
      verificationRunId: 'verification-run-1',
      attempt: 1,
      projectId: project.projectId,
      workspaceId: 'loop-verify-1',
      target: { path: '/tmp/loop-verify-1', machine: { kind: 'local' as const } },
      featureTarget,
      branchName: 'emdash/loop-verify-1',
      baseCommit: BASE_COMMIT,
      expectedFeatureHead: FEATURE_COMMIT,
      worktreeOwnership: 'attested' as const,
      teardownRequired: true,
      branchHead: FEATURE_COMMIT,
      completed: { teardown: false, worktree: false, branch: false },
      revision: 7,
    };
    vi.mocked(harness.dependencies.cleanRoom.destroy).mockResolvedValueOnce(
      err({ type: 'cleanup-failed', message: 'teardown failed', pendingCleanup })
    );

    const result = await harness.gate.run(defaultInput);
    pendingCleanup.revision = 8;
    pendingCleanup.completed.teardown = true;

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cleanup-failed',
        stage: 'cleanup',
        pendingCleanup: {
          cleanupId: 'cleanup-loop-verify-1',
          revision: 7,
          completed: { teardown: false, worktree: false, branch: false },
        },
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
      },
    });
    expect(harness.dependencies.authority.inspectFeature).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-undefined success payload', () => ok({ unexpected: 'destruction authority' }) as never],
    [
      'a throwing success payload getter',
      () =>
        Object.defineProperty({ success: true }, 'data', {
          enumerable: true,
          get: () => {
            throw new Error('hostile destruction success getter');
          },
        }) as never,
    ],
  ] as const)('retains durable workspace authority for %s', async (_name, makeResult) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.cleanRoom.destroy).mockResolvedValueOnce(makeResult());

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cleanup-failed',
        stage: 'cleanup',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        pendingWorkspace: {
          cleanupId: 'cleanup-loop-verify-1',
          verificationRunId: 'verification-run-1',
        },
      },
    });
    const workspaceCleared = vi
      .mocked(harness.dependencies.progress.commit)
      .mock.calls.some(
        ([input]) => input.transition.kind === 'workspace' && input.transition.verification === null
      );
    expect(workspaceCleared).toBe(false);
    expect(harness.dependencies.authority.inspectFeature).not.toHaveBeenCalled();
  });

  it('destroys a late-created workspace after abort without acquiring execution', async () => {
    const controller = new AbortController();
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    type CreateResult = Awaited<ReturnType<CleanRoomE2EGateDependencies['cleanRoom']['create']>>;
    const deferred = Promise.withResolvers<CreateResult>();
    vi.mocked(harness.dependencies.cleanRoom.create).mockReturnValueOnce(deferred.promise);
    const run = harness.gate.run({ ...defaultInput, signal: controller.signal });
    await vi.waitFor(() => expect(harness.dependencies.cleanRoom.create).toHaveBeenCalledOnce());
    controller.abort();
    deferred.resolve(
      ok({
        projectId: project.projectId,
        cleanupId: 'cleanup-loop-verify-1',
        verificationRunId: 'verification-run-1',
        attempt: 1,
        target: {
          workspaceId: 'loop-verify-1',
          path: '/tmp/verification-workspace-1',
          machine: { kind: 'local' },
        },
        branchName: 'emdash/verification-workspace-1',
        baseCommit: BASE_COMMIT,
        expectedFeatureHead: FEATURE_COMMIT,
        replayedThroughCommit: FEATURE_COMMIT,
      })
    );

    const result = await run;

    expect(result).toMatchObject({
      success: false,
      error: { type: 'cancelled', stage: 'create', lastWorkspaceDestroyed: true },
    });
    expect(harness.dependencies.execution.acquire).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it('rejects oversized aggregate prompt data before creating resources or sessions', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const largeHandoff = {
      source: 'prior-phase',
      handoff: {
        summary: 'x'.repeat(16_384),
        risks: [],
        remainingWork: [],
        artifacts: [],
        createdAt: '2026-07-12T00:30:00.000Z',
      },
    };

    const result = await harness.gate.run({
      ...defaultInput,
      handoffs: Array.from({ length: 40 }, () => largeHandoff),
    });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'invalid-input', stage: 'precondition', attempt: 0 },
    });
    expect(harness.dependencies.prerequisites.resolve).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
    expect(harness.dependencies.execution.acquire).not.toHaveBeenCalled();
    expect(harness.dependencies.session.cancelE2ESession).not.toHaveBeenCalled();
    expect(harness.dependencies.session.sendE2EPrompt).not.toHaveBeenCalled();
    expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it('cancels the preallocated identity when session start rejects after an uncertain side effect', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.session.startFreshE2ESession).mockRejectedValueOnce(
      new Error('start transport disconnected')
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'session-start',
        lastWorkspaceDestroyed: true,
      },
    });
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'e2e-attempt-1',
        conversationId: 'e2e-conversation-1',
        phaseId: phase.id,
        verificationRunId: 'verification-run-1',
      })
    );
    expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it('rejects malformed required-check data without throwing or losing cleanup', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.requiredChecks.run).mockResolvedValueOnce(
      ok({ status: 'passed' } as never)
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { type: 'required-checks-authority-invalid', stage: 'required-checks' },
    });
    expect(harness.calls).toContain('release:1');
    expect(harness.calls).toContain('destroy:1');
  });

  it.each([undefined, 'text/html'] as const)(
    'fails closed when native screenshot evidence has MIME authority %s',
    async (mimeType) => {
      const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
      mutateRequiredChecksOnce(harness, (checks) => ({
        ...checks,
        nativeEvidence: {
          ...checks.nativeEvidence,
          artifacts: [
            {
              artifactId: 'native-screenshot',
              kind: 'screenshot',
              ...(mimeType === undefined ? {} : { mimeType }),
              byteLength: 128,
              createdAt: '2026-07-12T01:03:30.000Z',
            },
          ],
        },
      }));

      const result = await harness.gate.run(defaultInput);

      expect(result).toMatchObject({
        success: false,
        error: { type: 'native-verifier-authority-invalid', stage: 'required-checks' },
      });
      expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
      expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
    }
  );

  it('rejects a runtime non-string task environment value without throwing', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const acquire = vi.mocked(harness.dependencies.execution.acquire);
    const original = acquire.getMockImplementation()!;
    acquire.mockImplementationOnce(async (input) => {
      const result = await original(input);
      if (!result.success) return result;
      const taskEnvironment = {
        ...result.data.taskEnvironment,
        EMDASH_TASK_NAME: 42 as unknown as string,
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
      error: { type: 'task-environment-invalid', stage: 'execution' },
    });
    expect(harness.dependencies.session.startFreshE2ESession).not.toHaveBeenCalled();
  });

  it('enforces the aggregate UTF-8 task-environment byte bound independently', async () => {
    const wide = '\u0800'.repeat(4_096);
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const acquire = vi.mocked(harness.dependencies.execution.acquire);
    const originalAcquire = acquire.getMockImplementation()!;
    acquire.mockImplementationOnce(async (input) => {
      const result = await originalAcquire(input);
      if (!result.success) return result;
      const taskEnvironment = {
        EMDASH_DEFAULT_BRANCH: wide,
        EMDASH_PORT: wide,
        EMDASH_ROOT_PATH: wide,
        EMDASH_TASK_ID: wide,
        EMDASH_TASK_NAME: wide,
        EMDASH_TASK_PATH: wide,
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
      error: { type: 'task-environment-invalid', stage: 'execution' },
    });
    expect(harness.dependencies.session.startFreshE2ESession).not.toHaveBeenCalled();
  });

  it('marks final feature-inspection rejection as recovery-required after destruction', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.authority.inspectFeature).mockRejectedValueOnce(
      new Error('feature authority unavailable')
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'finalize',
        recoveryRequired: true,
        lastWorkspaceDestroyed: true,
      },
    });
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('clock unavailable');
      },
    ],
    ['returns an invalid Date', () => new Date(Number.NaN)],
  ] as const)('keeps active resources cleanly releasable when now() %s', async (_name, failNow) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date('2026-07-12T01:02:03.000Z'))
      .mockImplementation(failNow);
    harness.dependencies.now = now;

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: true,
      data: { lastWorkspaceDestroyed: true, stageResult: { status: 'passed' } },
    });
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledOnce();
    expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'rejects',
      (harness: Harness) =>
        vi
          .mocked(harness.dependencies.execution.acquire)
          .mockRejectedValueOnce(new Error('execution transport disconnected')),
      'dependency-rejected',
    ],
    [
      'returns a malformed success payload',
      (harness: Harness) =>
        vi
          .mocked(harness.dependencies.execution.acquire)
          .mockResolvedValueOnce(ok(undefined as never)),
      'dependency-rejected',
    ],
  ] as const)(
    'preserves workspace authority without unsafe cleanup when execution acquisition %s',
    async (_name, arrange, type) => {
      const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
      arrange(harness);

      const result = await harness.gate.run(defaultInput);

      expect(result).toMatchObject({
        success: false,
        error: {
          type,
          stage: 'execution',
          recoveryRequired: true,
          lastWorkspaceDestroyed: false,
          pendingWorkspace: {
            projectId: project.projectId,
            cleanupId: 'cleanup-loop-verify-1',
            verificationRunId: 'verification-run-1',
            attempt: 1,
            target: {
              workspaceId: 'verification-workspace-1',
              path: '/tmp/verification-workspace-1',
              machine: { kind: 'local' },
            },
            expectedFeatureHead: FEATURE_COMMIT,
          },
        },
      });
      expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
      expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
    }
  );

  it('rejects an undefined integration success payload after authoritative cleanup', async () => {
    const harness = makeHarness([
      {
        finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
    ]);
    vi.mocked(harness.dependencies.cleanRoom.integrateFix).mockResolvedValueOnce(
      ok(undefined as never)
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'correction',
        recoveryRequired: true,
        lastWorkspaceDestroyed: true,
      },
    });
    expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
    expect(harness.dependencies.authority.inspectFeature).toHaveBeenCalledOnce();
  });

  it('retains the workspace when cancellation returns an undefined success payload', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.session.cancelE2ESession).mockResolvedValueOnce(
      ok(undefined as never)
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'quiescence',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        pendingWorkspace: {
          cleanupId: 'cleanup-loop-verify-1',
          verificationRunId: 'verification-run-1',
          expectedFeatureHead: FEATURE_COMMIT,
        },
      },
    });
    expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it('lets an undefined release success payload override a green candidate', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.execution.release).mockResolvedValueOnce(ok(undefined as never));

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cleanup-failed',
        stage: 'cleanup',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        pendingWorkspace: {
          cleanupId: 'cleanup-loop-verify-1',
          verificationRunId: 'verification-run-1',
          expectedFeatureHead: FEATURE_COMMIT,
        },
      },
    });
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
    expect(harness.dependencies.authority.inspectFeature).not.toHaveBeenCalled();
  });

  it('returns a typed recovery error when final feature inspection has no payload', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.authority.inspectFeature).mockResolvedValueOnce(
      ok(undefined as never)
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'dependency-rejected',
        stage: 'finalize',
        recoveryRequired: true,
        lastWorkspaceDestroyed: true,
      },
    });
    expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it.each([
    ['local', featureTarget, project],
    [
      'SSH',
      sshFeatureTarget,
      {
        ...project,
        defaultWorkspaceMachine: sshFeatureTarget.machine,
      } as unknown as CleanRoomProject,
    ],
  ] as const)(
    'rejects a trim-normalized %s feature-target alias without unsafe cleanup',
    async (_name, aliasedFeatureTarget, aliasedProject) => {
      const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }], aliasedFeatureTarget);
      vi.mocked(harness.dependencies.cleanRoom.create).mockImplementationOnce(async (input) =>
        ok({
          projectId: aliasedProject.projectId,
          cleanupId: 'cleanup-normalized-alias',
          verificationRunId: input.verificationRunId,
          attempt: input.attempt,
          target: {
            workspaceId: ` ${aliasedFeatureTarget.workspaceId} `,
            path: ` ${aliasedFeatureTarget.path} `,
            machine: { ...aliasedFeatureTarget.machine },
          },
          branchName: 'emdash/normalized-alias',
          baseCommit: input.baseCommit,
          expectedFeatureHead: input.expectedFeatureHead,
          replayedThroughCommit: input.expectedFeatureHead,
        })
      );

      const result = await harness.gate.run({
        ...defaultInput,
        project: aliasedProject,
        featureTarget: aliasedFeatureTarget,
      });

      expect(result).toMatchObject({
        success: false,
        error: {
          type: 'target-drift',
          stage: 'create',
          recoveryRequired: true,
          lastWorkspaceDestroyed: false,
        },
      });
      expect(harness.dependencies.execution.acquire).not.toHaveBeenCalled();
      expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
      expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
    }
  );

  it('cancels identical session identities once per sequential gate run', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);

    const first = await harness.gate.run(defaultInput);
    const second = await harness.gate.run(defaultInput);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'missing persisted v2 config',
      (input: RunCleanRoomE2EGateInput) => ({
        ...input,
        loop: { ...loop, config: null },
      }),
    ],
    [
      'missing persisted v1 state',
      (input: RunCleanRoomE2EGateInput) => ({
        ...input,
        loop: { ...loop, state: null },
      }),
    ],
    [
      'persisted provider drift',
      (input: RunCleanRoomE2EGateInput) => ({
        ...input,
        loop: loopWithConfig({ provider: 'claude' }),
      }),
    ],
    [
      'caller model drift',
      (input: RunCleanRoomE2EGateInput) => ({ ...input, model: 'different-model' }),
    ],
    [
      'persisted model drift',
      (input: RunCleanRoomE2EGateInput) => ({
        ...input,
        loop: loopWithConfig({ model: 'different-model' }),
      }),
    ],
    [
      'persisted terminal-gate drift',
      (input: RunCleanRoomE2EGateInput) => ({
        ...input,
        loop: loopWithConfig({
          terminalGates: { review: false, e2e: true },
          reviewEnabled: false,
        }),
      }),
    ],
    [
      'persisted base drift',
      (input: RunCleanRoomE2EGateInput) => ({
        ...input,
        loop: loopWithState({ baseCommit: '4'.repeat(40) }),
      }),
    ],
    [
      'persisted expected-head drift',
      (input: RunCleanRoomE2EGateInput) => ({
        ...input,
        loop: loopWithState({ expectedFeatureHead: '4'.repeat(40) }),
      }),
    ],
    [
      'persisted checkpoint-head drift',
      (input: RunCleanRoomE2EGateInput) => ({
        ...input,
        loop: loopWithState({ checkpointCommit: '4'.repeat(40) }),
      }),
    ],
  ] as const)('rejects %s before allocating clean-room resources', async (_name, mutateInput) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);

    const result = await harness.gate.run(mutateInput(defaultInput));

    expect(result).toMatchObject({
      success: false,
      error: { type: 'invalid-input', stage: 'precondition', attempt: 0 },
    });
    expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
  });

  it.each([
    ['attempt ID', (value: Record<string, unknown>) => ({ ...value, attemptId: 'work-attempt-1' })],
    [
      'conversation ID',
      (value: Record<string, unknown>) => ({ ...value, conversationId: 'work-1' }),
    ],
  ] as const)('rejects historical outer-session %s reuse', async (_name, mutate) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const returnedIdentity = mutate({
      attemptId: 'e2e-attempt-1',
      conversationId: 'e2e-conversation-1',
    }) as { attemptId: string; conversationId: string };
    const start = vi.mocked(harness.dependencies.session.startFreshE2ESession);
    const original = start.getMockImplementation()!;
    start.mockImplementationOnce(async (input) => {
      const result = await original(input);
      return result.success
        ? ok(mutate(result.data as unknown as Record<string, unknown>) as never)
        : result;
    });

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        stage: 'quiescence',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        sessionAttempts: [
          {
            attemptId: 'e2e-attempt-1',
            conversationId: 'e2e-conversation-1',
            status: 'interrupted',
          },
        ],
      },
    });
    if (result.success) throw new Error('Expected stale session rejection.');
    expect(result.error.sessionAttempts).toHaveLength(1);
    expect(result.error.sessionAttempts[0]).not.toMatchObject({
      attemptId: 'work-attempt-1',
      conversationId: 'work-1',
    });
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledTimes(2);
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'e2e-attempt-1',
        conversationId: 'e2e-conversation-1',
      })
    );
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledWith(
      expect.objectContaining(returnedIdentity)
    );
    expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it.each([
    [
      'attempt ID',
      (result: E2ERequiredChecksResult) => ({
        ...result,
        sessionAttempts: [{ ...result.sessionAttempts[0]!, attemptId: 'work-attempt-1' }],
      }),
    ],
    [
      'conversation ID',
      (result: E2ERequiredChecksResult) => ({
        ...result,
        sessionAttempts: [{ ...result.sessionAttempts[0]!, conversationId: 'work-1' }],
      }),
    ],
  ] as const)('rejects historical nested-session %s reuse', async (_name, mutate) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    mutateRequiredChecksOnce(harness, mutate);

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'native-verifier-ledger-ambiguous',
        stage: 'required-checks',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
      },
    });
    expect(harness.dependencies.execution.release).not.toHaveBeenCalled();
    expect(harness.dependencies.cleanRoom.destroy).not.toHaveBeenCalled();
  });

  it.each([
    ['purpose', (value: Record<string, unknown>) => ({ ...value, purpose: 'review' })],
    ['phase', (value: Record<string, unknown>) => ({ ...value, phaseId: 'different-phase' })],
    ['attempt', (value: Record<string, unknown>) => ({ ...value, attempt: 2 })],
  ] as const)(
    'rejects a wrong session-start %s echo after quiescent cleanup',
    async (_name, mutate) => {
      const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
      const start = vi.mocked(harness.dependencies.session.startFreshE2ESession);
      const original = start.getMockImplementation()!;
      start.mockImplementationOnce(async (input) => {
        const result = await original(input);
        return result.success
          ? ok(mutate(result.data as unknown as Record<string, unknown>) as never)
          : result;
      });

      const result = await harness.gate.run(defaultInput);

      expect(result).toMatchObject({
        success: false,
        error: {
          type: 'session-authority-invalid',
          stage: 'session-start',
          lastWorkspaceDestroyed: true,
        },
      });
      expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledOnce();
      expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
      expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
    }
  );

  it.each([
    ['attempt ID', (value: Record<string, unknown>) => ({ ...value, attemptId: 'different-id' })],
    ['purpose', (value: Record<string, unknown>) => ({ ...value, purpose: 'review' })],
    ['phase', (value: Record<string, unknown>) => ({ ...value, phaseId: 'different-phase' })],
    ['attempt', (value: Record<string, unknown>) => ({ ...value, attempt: 2 })],
  ] as const)('rejects a wrong prompt %s echo after quiescent cleanup', async (_name, mutate) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const prompt = vi.mocked(harness.dependencies.session.sendE2EPrompt);
    const original = prompt.getMockImplementation()!;
    prompt.mockImplementationOnce(async (input) => {
      const result = await original(input);
      return result.success
        ? ok(mutate(result.data as unknown as Record<string, unknown>) as never)
        : result;
    });

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'prompt-authority-invalid',
        stage: 'prompt',
        lastWorkspaceDestroyed: true,
      },
    });
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledOnce();
    expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it.each([
    ['attempt ID', (value: Record<string, unknown>) => ({ ...value, attemptId: 'different-id' })],
    ['purpose', (value: Record<string, unknown>) => ({ ...value, purpose: 'review' })],
    ['phase', (value: Record<string, unknown>) => ({ ...value, phaseId: 'different-phase' })],
    ['attempt', (value: Record<string, unknown>) => ({ ...value, attempt: 2 })],
  ] as const)('retains the workspace for a wrong cancellation %s echo', async (_name, mutate) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const cancel = vi.mocked(harness.dependencies.session.cancelE2ESession);
    const original = cancel.getMockImplementation()!;
    cancel.mockImplementationOnce(async (input) => {
      const result = await original(input);
      return result.success
        ? ok(mutate(result.data as unknown as Record<string, unknown>) as never)
        : result;
    });

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
    ['loop ID', (value: E2ERequiredChecksResult) => ({ ...value, loopId: 'different-loop' })],
    ['phase ID', (value: E2ERequiredChecksResult) => ({ ...value, phaseId: 'different-phase' })],
    [
      'full-check attestation',
      (value: E2ERequiredChecksResult) =>
        ({ ...value, fullChecksRan: false }) as unknown as E2ERequiredChecksResult,
    ],
    [
      'ordered validation commands',
      (value: E2ERequiredChecksResult) => ({
        ...value,
        validationCommands: [...value.validationCommands].reverse(),
      }),
    ],
    [
      'ordered criteria',
      (value: E2ERequiredChecksResult) => ({
        ...value,
        criteria: [...value.criteria].reverse(),
      }),
    ],
  ] as const)('rejects required-check %s drift', async (_name, mutate) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    mutateRequiredChecksOnce(harness, mutate);

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { type: 'required-checks-authority-invalid', stage: 'required-checks' },
    });
    expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
  });

  it('retains one independently exact nested attempt from malformed top-level checks', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const checks = vi.mocked(harness.dependencies.requiredChecks.run);
    const original = checks.getMockImplementation()!;
    checks.mockImplementationOnce(async (input) => {
      const result = await original(input);
      if (!result.success) return result;
      return ok({ ...result.data, loopId: undefined } as never);
    });

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'required-checks-authority-invalid',
        stage: 'required-checks',
        sessionAttempts: [
          {
            attemptId: 'e2e-attempt-1',
            purpose: 'e2e',
            status: 'failed',
          },
          {
            attemptId: 'browser-verification-run-1',
            purpose: 'browser-verification',
            status: 'completed',
            target: {
              workspaceId: 'verification-workspace-1',
              path: '/tmp/verification-workspace-1',
            },
          },
        ],
      },
    });
  });

  it.each([
    ['malformed', () => ({ cleanupId: 'cleanup-loop-verify-1', revision: 7 })],
    [
      'oversized',
      () => ({
        version: '1',
        cleanupId: 'cleanup-loop-verify-oversized',
        verificationRunId: 'verification-run-1',
        attempt: 1,
        projectId: project.projectId,
        workspaceId: 'loop-verify-oversized',
        target: { path: `/${'x'.repeat(20_000)}`, machine: { kind: 'local' } },
        featureTarget,
        branchName: 'emdash/loop-verify-oversized',
        baseCommit: BASE_COMMIT,
        expectedFeatureHead: FEATURE_COMMIT,
        worktreeOwnership: 'attested',
        teardownRequired: true,
        branchHead: FEATURE_COMMIT,
        completed: { teardown: false, worktree: false, branch: false },
        revision: 7,
      }),
    ],
    [
      'cyclic',
      () => {
        const completed: Record<string, unknown> = {
          teardown: false,
          worktree: false,
          branch: false,
        };
        const value: Record<string, unknown> = {
          version: '1',
          cleanupId: 'cleanup-loop-verify-cyclic',
          verificationRunId: 'verification-run-1',
          attempt: 1,
          projectId: project.projectId,
          workspaceId: 'loop-verify-cyclic',
          target: { path: '/tmp/cyclic', machine: { kind: 'local' } },
          featureTarget,
          branchName: 'emdash/loop-verify-cyclic',
          baseCommit: BASE_COMMIT,
          expectedFeatureHead: FEATURE_COMMIT,
          worktreeOwnership: 'attested',
          teardownRequired: true,
          branchHead: FEATURE_COMMIT,
          completed,
          revision: 7,
        };
        completed.teardown = value;
        return value;
      },
    ],
    [
      'foreign but structurally valid',
      () => ({
        version: '1',
        cleanupId: 'cleanup-loop-verify-foreign',
        verificationRunId: 'verification-run-foreign',
        attempt: 1,
        projectId: 'foreign-project',
        workspaceId: 'loop-verify-foreign',
        target: { path: '/tmp/foreign', machine: { kind: 'local' } },
        featureTarget,
        branchName: 'emdash/loop-verify-foreign',
        baseCommit: BASE_COMMIT,
        expectedFeatureHead: FEATURE_COMMIT,
        worktreeOwnership: 'attested',
        teardownRequired: true,
        branchHead: FEATURE_COMMIT,
        completed: { teardown: false, worktree: false, branch: false },
        revision: 7,
      }),
    ],
  ] as const)('omits %s pending cleanup without throwing', async (_name, makePendingCleanup) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.cleanRoom.destroy).mockResolvedValueOnce(
      err({
        type: 'cleanup-failed',
        message: 'teardown failed',
        pendingCleanup: makePendingCleanup(),
      })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cleanup-failed',
        stage: 'cleanup',
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
      },
    });
    if (result.success) throw new Error('Expected cleanup failure.');
    expect(result.error).not.toHaveProperty('pendingCleanup');
  });
});
