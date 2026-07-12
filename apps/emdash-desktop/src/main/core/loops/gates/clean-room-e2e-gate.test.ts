import { describe, expect, it, vi } from 'vitest';
import { ok } from '@main/lib/result';
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
});
