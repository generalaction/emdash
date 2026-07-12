import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@main/lib/result';
import type { LoopSessionTarget } from '@shared/core/loops/loop-state';
import type { Loop, LoopPhase } from '@shared/core/loops/loops';
import type { CleanRoomProject } from '../clean-room/clean-room-workspace-service';
import {
  CleanRoomE2EGate,
  type CleanRoomE2EGateDependencies,
  type E2ERequiredChecksResult,
  type RunCleanRoomE2EGateInput,
} from './clean-room-e2e-gate';

const BASE_COMMIT = '1'.repeat(40);
const FEATURE_COMMIT = '2'.repeat(40);
const FIX_COMMIT = '3'.repeat(40);

const featureTarget: LoopSessionTarget = {
  workspaceId: 'feature-workspace',
  path: '/tmp/feature-workspace',
  machine: { kind: 'local' },
};

const sshFeatureTarget: LoopSessionTarget = {
  workspaceId: 'feature-workspace-ssh',
  path: '/srv/emdash/feature-workspace',
  machine: { kind: 'ssh', connectionId: 'ssh-production' },
};

const loop: Loop = {
  id: 'loop-1',
  projectId: 'project-1',
  taskId: 'task-1',
  name: 'Loop',
  slug: 'loop',
  status: 'running',
  currentPhaseIndex: 2,
  config: null,
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
};

const phase: LoopPhase = {
  id: 'phase-e2e',
  loopId: loop.id,
  idx: 2,
  name: 'Independent E2E',
  goal: 'Verify the complete change.',
  status: 'reviewing',
  attempts: 0,
  conversationId: null,
  criteria: null,
  lastError: null,
  kind: 'e2e',
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
};

const passedStage = {
  status: 'passed' as const,
  summary: 'Passed.',
  completedAt: '2026-07-12T00:30:00.000Z',
};

const project = {
  projectId: loop.projectId,
  repoPath: '/tmp/project',
  defaultWorkspaceMachine: { kind: 'local' },
} as unknown as CleanRoomProject;

function environment(target: LoopSessionTarget): Readonly<Record<string, string>> {
  return {
    EMDASH_DEFAULT_BRANCH: 'main',
    EMDASH_PORT: '50100',
    EMDASH_ROOT_PATH: project.repoPath,
    EMDASH_TASK_ID: loop.taskId,
    EMDASH_TASK_NAME: 'loop-task',
    EMDASH_TASK_PATH: target.path,
  };
}

const defaultInput: RunCleanRoomE2EGateInput = {
  loop,
  phase,
  task: { id: loop.taskId, name: 'Loop task' },
  project,
  featureTarget,
  provider: 'codex',
  model: 'gpt-5.6-sol',
  terminalGates: { review: true, e2e: true },
  workPhaseResults: [passedStage, passedStage],
  reviewStageResult: passedStage,
  previousConversationIds: ['work-1', 'work-2', 'review-1'],
  goal: 'Finish ACP Loops v2.',
  acceptanceCriteria: ['The clean-room result is independently green.'],
  baseCommit: BASE_COMMIT,
  checkpointCommit: FEATURE_COMMIT,
  handoffs: [],
  intermediateFailures: [],
  maxAttempts: 3,
};

type AttemptScript = {
  finalText: string;
  postHead?: string;
  mutated?: boolean;
  clean?: boolean;
  checks?: E2ERequiredChecksResult;
};

type Harness = {
  gate: CleanRoomE2EGate;
  dependencies: CleanRoomE2EGateDependencies;
  calls: string[];
};

function makeHarness(scripts: readonly AttemptScript[], target = featureTarget): Harness {
  const calls: string[] = [];
  let attempt = 0;
  let inspectCount = 0;
  let acceptedFeatureHead = FEATURE_COMMIT;
  let activeTarget: LoopSessionTarget | undefined;
  const released = new Set<string>();

  const dependencies: CleanRoomE2EGateDependencies = {
    cleanRoom: {
      create: vi.fn(async (input) => {
        attempt = input.attempt;
        inspectCount = 0;
        activeTarget = {
          workspaceId: `verification-workspace-${attempt}`,
          path:
            target.machine.kind === 'local'
              ? `/tmp/verification-workspace-${attempt}`
              : `/srv/emdash/verification-workspace-${attempt}`,
          machine: { ...target.machine },
        };
        calls.push(`create:${attempt}:${input.expectedFeatureHead}`);
        return ok({
          projectId: project.projectId,
          cleanupId: `cleanup-loop-verify-${attempt}`,
          verificationRunId: input.verificationRunId,
          attempt,
          target: activeTarget,
          branchName: `emdash/${activeTarget.workspaceId}`,
          baseCommit: BASE_COMMIT,
          expectedFeatureHead: input.expectedFeatureHead,
          replayedThroughCommit: input.expectedFeatureHead,
        });
      }),
      integrateFix: vi.fn(async (input) => {
        calls.push(`integrate:${attempt}:${input.fixCommit}`);
        acceptedFeatureHead = input.fixCommit;
        return ok({ featureHead: input.fixCommit });
      }),
      destroy: vi.fn(async (workspace) => {
        calls.push(`destroy:${workspace.attempt}`);
        return ok(undefined);
      }),
    },
    authority: {
      beginAttempt: vi.fn(async (input) => {
        calls.push(`begin:${attempt}`);
        return ok({
          target: input.target,
          headCommit: acceptedFeatureHead,
          clean: true,
          branchAttached: true,
          mutationBaseline: `baseline-${attempt}`,
        });
      }),
      inspectAttempt: vi.fn(async (input) => {
        inspectCount += 1;
        const script = scripts[attempt - 1] ?? scripts.at(-1);
        const isPostPrompt = inspectCount === 1;
        const headCommit = isPostPrompt && script?.postHead ? script.postHead : acceptedFeatureHead;
        calls.push(`inspect:${attempt}:${isPostPrompt ? 'prompt' : 'checks'}`);
        return ok({
          target: input.target,
          headCommit,
          clean: script?.clean ?? true,
          branchAttached: true,
          mutationBaseline: input.mutationBaseline,
          mutated: isPostPrompt ? (script?.mutated ?? false) : false,
        });
      }),
      inspectFeature: vi.fn(async (input) => {
        calls.push(`feature:${attempt}:${acceptedFeatureHead}`);
        return ok({
          target: input.target,
          headCommit: acceptedFeatureHead,
          clean: true,
          branchAttached: true,
        });
      }),
    },
    execution: {
      acquire: vi.fn(async (input) => {
        calls.push(`acquire:${attempt}`);
        const taskEnvironment = environment(input.cleanRoom.target);
        return ok({
          target: input.cleanRoom.target,
          taskEnvironment,
          executionTarget: {
            ...input.cleanRoom.target,
            taskEnv: taskEnvironment,
            executionContext: { dispose: vi.fn() },
            dispose: vi.fn(),
          },
        });
      }),
      release: vi.fn(async (input) => {
        calls.push(`release:${attempt}`);
        released.add(input.target.workspaceId);
        input.executionTarget.dispose();
        return ok({ target: input.target, released: true as const });
      }),
    },
    session: {
      startFreshE2ESession: vi.fn(async (input) => {
        calls.push(`start:${attempt}`);
        return ok({
          attemptId: `e2e-attempt-${attempt}`,
          conversationId: `e2e-conversation-${attempt}`,
          verificationRunId: input.verificationRunId,
          attempt: input.attempt,
          target: input.target,
          provider: input.provider,
          model: input.model,
          taskEnvironment: input.taskEnvironment,
        });
      }),
      sendE2EPrompt: vi.fn(async (input) => {
        calls.push(`prompt:${attempt}`);
        return ok({
          conversationId: input.conversationId,
          verificationRunId: input.verificationRunId,
          attempt: input.attempt,
          target: input.target,
          finalText: scripts[attempt - 1]?.finalText ?? '<<<LOOP:E2E_PASSED>>>',
        });
      }),
      cancelE2ESession: vi.fn(async (input) => {
        calls.push(`cancel:${attempt}`);
        return ok({ ...input, quiescent: true as const });
      }),
    },
    requiredChecks: {
      run: vi.fn(async (input) => {
        calls.push(`checks:${attempt}`);
        const scripted = scripts[attempt - 1]?.checks;
        return ok(
          scripted ??
            requiredChecksResult({
              target: input.target,
              checkpointCommit: input.checkpointCommit,
              verificationRunId: input.verificationRunId,
              outerConversationId: input.conversationId,
              taskEnvironment: input.taskEnvironment,
              attempt: input.attempt,
            })
        );
      }),
    },
    createVerificationRunId: (nextAttempt) => `verification-run-${nextAttempt}`,
    now: () => new Date('2026-07-12T01:02:03.000Z'),
  };

  return { gate: new CleanRoomE2EGate(dependencies), dependencies, calls };
}

function requiredChecksResult(input: {
  target: LoopSessionTarget;
  checkpointCommit: string;
  verificationRunId: string;
  outerConversationId: string;
  taskEnvironment: Readonly<Record<string, string>>;
  attempt?: number;
  status?: 'passed' | 'correctable' | 'failed';
}): E2ERequiredChecksResult {
  const status = input.status ?? 'passed';
  return {
    status,
    verificationRunId: input.verificationRunId,
    attempt: input.attempt ?? 1,
    outerConversationId: input.outerConversationId,
    target: input.target,
    executionTarget: input.target,
    checkpointCommit: input.checkpointCommit,
    provider: 'codex',
    model: 'gpt-5.6-sol',
    taskEnvironment: input.taskEnvironment,
    requiredTestsSummary: status === 'passed' ? 'Full checks passed.' : 'Full checks found a bug.',
    nativeBrowserRan: true,
    nativePreview: {
      invocationCount: 1,
      passed: status === 'passed',
      summary: status === 'passed' ? 'Native preview passed.' : 'Native preview found a bug.',
      target: input.target,
      provider: 'codex',
      model: 'gpt-5.6-sol',
      taskEnvironment: input.taskEnvironment,
    },
    sessionAttempts: [
      {
        attemptId: `browser-${input.verificationRunId}`,
        conversationId: `browser-conversation-${input.verificationRunId}`,
        purpose: 'browser-verification',
        phaseId: phase.id,
        verificationRunId: input.verificationRunId,
        target: input.target,
        status: 'completed',
        checkpointBefore: input.checkpointCommit,
        checkpointAfter: input.checkpointCommit,
        startedAt: '2026-07-12T01:01:00.000Z',
        finishedAt: '2026-07-12T01:01:30.000Z',
      },
    ],
    ...(status === 'correctable'
      ? {
          handoff: {
            source: 'Authoritative E2E checks',
            handoff: {
              summary: 'The native preview exposed a correctable dialog bug.',
              risks: ['The correction still needs a fresh replay.'],
              remainingWork: ['Fix the dialog and create one correction checkpoint.'],
              artifacts: [
                {
                  artifactId: 'native-diagnostics',
                  kind: 'browser-diagnostics',
                  byteLength: 128,
                  createdAt: '2026-07-12T01:01:30.000Z',
                },
              ],
              createdAt: '2026-07-12T01:01:30.000Z',
            },
          },
        }
      : {}),
  };
}

function mutateRequiredChecksOnce(
  harness: Harness,
  mutate: (result: E2ERequiredChecksResult) => E2ERequiredChecksResult
): void {
  const checks = vi.mocked(harness.dependencies.requiredChecks.run);
  const original = checks.getMockImplementation()!;
  checks.mockImplementationOnce(async (input) => {
    const result = await original(input);
    return result.success ? ok(mutate(result.data)) : result;
  });
}

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
        stageResult: { status: 'passed' },
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
      data: { attempts: 3, correctionCount: 1, featureHead: FIX_COMMIT },
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
      {
        finalText: 'Fixed.\n<<<LOOP:E2E_CORRECTION_READY fixed dialog>>>',
        postHead: FIX_COMMIT,
        mutated: true,
      },
    ]);

    const result = await harness.gate.run({ ...defaultInput, maxAttempts: 1 });

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'attempts-exhausted',
        featureHead: FIX_COMMIT,
        attempt: 1,
        stageResult: { status: 'failed' },
      },
    });
    expect(harness.calls).not.toContain('checks:1');
    expect(harness.calls).toContain('destroy:1');
  });

  it.each([
    [{ review: false, e2e: false }, undefined, 'e2e-disabled'],
    [{ review: true, e2e: false }, passedStage, 'e2e-disabled'],
    [{ review: true, e2e: true }, undefined, 'review-incomplete'],
    [{ review: false, e2e: true }, passedStage, 'review-order-invalid'],
  ] as const)(
    'rejects an invalid Review/E2E ordering',
    async (terminalGates, reviewStageResult, type) => {
      const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);

      const result = await harness.gate.run({
        ...defaultInput,
        terminalGates,
        reviewStageResult,
      });

      expect(result).toMatchObject({ success: false, error: { type, stage: 'precondition' } });
      expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
    }
  );

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
      error: { type: 'native-verifier-ledger-invalid', stage: 'required-checks' },
    });
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
            status: 'failed',
          },
        ],
      },
    });
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
    [
      'running status',
      (result: E2ERequiredChecksResult) => ({
        ...result,
        sessionAttempts: [
          { ...result.sessionAttempts[0]!, status: 'running', finishedAt: undefined },
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
  ] as const)('rejects nested browser ledger authority with %s', async (_name, mutate) => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    mutateRequiredChecksOnce(harness, mutate);

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: { type: 'native-verifier-ledger-invalid', stage: 'required-checks' },
    });
    expect(harness.calls).toContain('release:1');
    expect(harness.calls).toContain('destroy:1');
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
      error: { type: 'cancelled', stage: 'prompt', lastWorkspaceDestroyed: true },
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

    deferred.resolve(err({ type: 'cancelled', message: 'checks stopped' }));
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
    const pendingCleanup = { cleanupId: 'cleanup-loop-verify-1', revision: 7 };
    vi.mocked(harness.dependencies.cleanRoom.destroy).mockResolvedValueOnce(
      err({ type: 'cleanup-failed', message: 'teardown failed', pendingCleanup })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cleanup-failed',
        stage: 'cleanup',
        pendingCleanup,
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
      },
    });
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
          workspaceId: 'verification-workspace-1',
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

  it('cancels and cleans up when bounded prompt serialization rejects aggregate data', async () => {
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
      error: { type: 'invalid-input', stage: 'prompt', lastWorkspaceDestroyed: true },
    });
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledOnce();
    expect(harness.dependencies.session.sendE2EPrompt).not.toHaveBeenCalled();
    expect(harness.calls).toContain('release:1');
    expect(harness.calls).toContain('destroy:1');
  });

  it('retains workspace authority when session start rejects without proving no session exists', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    vi.mocked(harness.dependencies.session.startFreshE2ESession).mockRejectedValueOnce(
      new Error('start transport disconnected')
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
    const featurePath = `/${'\u0801'.repeat(4_095)}`;
    const cleanPath = `/${'\u0802'.repeat(4_095)}`;
    const longFeatureTarget: LoopSessionTarget = {
      workspaceId: 'feature-workspace-long',
      path: featurePath,
      machine: { kind: 'local' },
    };
    const longLoop = {
      ...loop,
      projectId: 'project-long',
      taskId: wide,
    };
    const longProject = {
      ...project,
      projectId: longLoop.projectId,
      repoPath: wide,
    } as unknown as CleanRoomProject;
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }], longFeatureTarget);
    vi.mocked(harness.dependencies.cleanRoom.create).mockImplementationOnce(async (input) =>
      ok({
        projectId: longProject.projectId,
        cleanupId: 'cleanup-long-environment',
        verificationRunId: input.verificationRunId,
        attempt: input.attempt,
        target: {
          workspaceId: 'verification-workspace-long',
          path: cleanPath,
          machine: { kind: 'local' },
        },
        branchName: 'emdash/verification-workspace-long',
        baseCommit: input.baseCommit,
        expectedFeatureHead: input.expectedFeatureHead,
        replayedThroughCommit: input.expectedFeatureHead,
      })
    );
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
        EMDASH_TASK_PATH: cleanPath,
      };
      return ok({
        ...result.data,
        taskEnvironment,
        executionTarget: { ...result.data.executionTarget, taskEnv: taskEnvironment },
      });
    });

    const result = await harness.gate.run({
      ...defaultInput,
      loop: longLoop,
      task: { id: wide, name: 'Long task' },
      project: longProject,
      featureTarget: longFeatureTarget,
    });

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
});
