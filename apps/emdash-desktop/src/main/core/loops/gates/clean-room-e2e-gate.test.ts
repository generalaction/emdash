import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@main/lib/result';
import type {
  LoopSessionAttempt,
  LoopSessionTarget,
  LoopState,
} from '@shared/core/loops/loop-state';
import type { Loop, LoopConfigV2, LoopPhase, LoopPhaseCriterion } from '@shared/core/loops/loops';
import type { CleanRoomProject } from '../clean-room/clean-room-workspace-service';
import type { CleanRoomPendingCleanup } from '../clean-room/cleanup-journal';
import {
  CleanRoomE2EGate,
  type CleanRoomE2EGateDependencies,
  type E2ERequiredChecksResult,
  type RunCleanRoomE2EGateInput,
} from './clean-room-e2e-gate';
import { reduceE2EProgress } from './clean-room-e2e-progress';

const BASE_COMMIT = '1'.repeat(40);
const FEATURE_COMMIT = '2'.repeat(40);
const FIX_COMMIT = '3'.repeat(40);
const VALIDATION_COMMANDS = ['pnpm run test', 'pnpm run typecheck'] as const;
const E2E_CRITERIA = [
  {
    description: 'The clean-room result is independently green.',
    verifier: 'agent-browser',
    status: 'pending',
  },
  {
    description: 'The required validation commands pass in order.',
    verifier: 'gh',
    status: 'pending',
  },
] as const satisfies readonly LoopPhaseCriterion[];

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
  config: {
    version: '2',
    provider: 'codex',
    model: 'gpt-5.6-sol',
    validationCommands: [...VALIDATION_COMMANDS],
    planSource: 'test plan',
    terminalGates: { review: true, e2e: true },
    browserPreview: { enabled: true },
    reviewEnabled: true,
    verifiers: [],
  },
  state: {
    version: '1',
    baseCommit: BASE_COMMIT,
    expectedFeatureHead: FEATURE_COMMIT,
    checkpointCommit: FEATURE_COMMIT,
    sessionAttempts: [
      {
        attemptId: 'work-attempt-1',
        conversationId: 'work-1',
        purpose: 'work',
        phaseId: 'phase-work-1',
        target: featureTarget,
        status: 'completed',
        checkpointBefore: BASE_COMMIT,
        checkpointAfter: FEATURE_COMMIT,
        startedAt: '2026-07-12T00:01:00.000Z',
        finishedAt: '2026-07-12T00:05:00.000Z',
      },
      {
        attemptId: 'work-attempt-2',
        conversationId: 'work-2',
        purpose: 'work',
        phaseId: 'phase-work-2',
        target: featureTarget,
        status: 'completed',
        checkpointBefore: BASE_COMMIT,
        checkpointAfter: FEATURE_COMMIT,
        startedAt: '2026-07-12T00:06:00.000Z',
        finishedAt: '2026-07-12T00:10:00.000Z',
      },
      {
        attemptId: 'review-attempt-1',
        conversationId: 'review-1',
        purpose: 'review',
        phaseId: 'phase-review',
        target: featureTarget,
        status: 'completed',
        checkpointBefore: FEATURE_COMMIT,
        checkpointAfter: FEATURE_COMMIT,
        startedAt: '2026-07-12T00:11:00.000Z',
        finishedAt: '2026-07-12T00:15:00.000Z',
      },
    ],
    verification: null,
  },
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
  criteria: { version: '1', criteria: E2E_CRITERIA.map((criterion) => ({ ...criterion })) },
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
    EMDASH_TASK_NAME: 'Loop task',
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
  goal: 'Finish ACP Loops v2.',
  acceptanceCriteria: ['The clean-room result is independently green.'],
  baseCommit: BASE_COMMIT,
  checkpointCommit: FEATURE_COMMIT,
  handoffs: [],
  intermediateFailures: [],
  maxAttempts: 3,
};

function loopWithTerminalGates(terminalGates: { review: boolean; e2e: boolean }): Loop {
  if (loop.config?.version !== '2') throw new Error('Expected a v2 Loop test fixture.');
  return {
    ...loop,
    config: {
      ...loop.config,
      terminalGates: { ...terminalGates },
      reviewEnabled: terminalGates.review,
    },
  };
}

function loopWithConfig(overrides: Partial<LoopConfigV2>): Loop {
  if (loop.config?.version !== '2') throw new Error('Expected a v2 Loop test fixture.');
  return { ...loop, config: { ...loop.config, ...overrides } };
}

function loopWithState(overrides: Partial<LoopState>): Loop {
  if (!loop.state || loop.state.version !== '1') {
    throw new Error('Expected a v1 Loop state test fixture.');
  }
  return { ...loop, state: { ...loop.state, ...overrides } };
}

function cleanTargetFor(target: LoopSessionTarget, attempt = 1): LoopSessionTarget {
  return {
    workspaceId: `verification-workspace-${attempt}`,
    path:
      target.machine.kind === 'local'
        ? `/tmp/verification-workspace-${attempt}`
        : `/srv/emdash/verification-workspace-${attempt}`,
    machine: { ...target.machine },
  };
}

function whitespaceAlias(target: LoopSessionTarget): LoopSessionTarget {
  return {
    workspaceId: ` ${target.workspaceId} `,
    path: ` ${target.path} `,
    machine:
      target.machine.kind === 'local'
        ? { kind: 'local' }
        : { kind: 'ssh', connectionId: ` ${target.machine.connectionId} ` },
  };
}

function makePendingCleanup(
  target: LoopSessionTarget = {
    workspaceId: 'loop-verify-1',
    path: '/tmp/loop-verify-1',
    machine: { kind: 'local' },
  },
  expectedFeatureHead = FEATURE_COMMIT
): CleanRoomPendingCleanup {
  return {
    version: '1',
    cleanupId: 'cleanup-loop-verify-1',
    verificationRunId: 'verification-run-1',
    attempt: 1,
    projectId: project.projectId,
    workspaceId: target.workspaceId,
    target: { path: target.path, machine: { ...target.machine } },
    featureTarget,
    branchName: `emdash/${target.workspaceId}`,
    baseCommit: BASE_COMMIT,
    expectedFeatureHead,
    worktreeOwnership: 'attested',
    teardownRequired: true,
    branchHead: expectedFeatureHead,
    completed: { teardown: false, worktree: false, branch: false },
    revision: 1,
  };
}

function historicalAttempts(count: number): LoopSessionAttempt[] {
  return Array.from({ length: count }, (_, index) => ({
    attemptId: `historical-attempt-${index}`,
    conversationId: `historical-conversation-${index}`,
    purpose: 'work' as const,
    phaseId: `historical-phase-${index}`,
    target: featureTarget,
    status: 'completed' as const,
    checkpointBefore: BASE_COMMIT,
    checkpointAfter: FEATURE_COMMIT,
    startedAt: '2026-07-12T00:01:00.000Z',
    finishedAt: '2026-07-12T00:02:00.000Z',
  }));
}

function nestedAttempt(
  overrides: Partial<LoopSessionAttempt> & Pick<LoopSessionAttempt, 'attemptId' | 'conversationId'>
): LoopSessionAttempt {
  return {
    purpose: 'browser-verification',
    phaseId: phase.id,
    verificationRunId: 'verification-run-1',
    target: cleanTargetFor(featureTarget),
    status: 'completed',
    checkpointBefore: FEATURE_COMMIT,
    checkpointAfter: FEATURE_COMMIT,
    startedAt: '2026-07-12T01:01:00.000Z',
    finishedAt: '2026-07-12T01:01:30.000Z',
    ...overrides,
  };
}

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
          attemptId: input.attemptId,
          conversationId: input.conversationId,
          purpose: input.purpose,
          phaseId: input.phaseId,
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
          attemptId: input.attemptId,
          conversationId: input.conversationId,
          purpose: input.purpose,
          phaseId: input.phaseId,
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
              loopId: input.authority.loopId,
              phaseId: input.authority.phaseId,
              target: input.target,
              checkpointCommit: input.checkpointCommit,
              verificationRunId: input.verificationRunId,
              outerConversationId: input.authority.outerConversationId,
              validationCommands: input.validationCommands ?? VALIDATION_COMMANDS,
              criteria: input.criteria ?? E2E_CRITERIA,
              taskEnvironment: input.taskEnvironment,
              attempt: input.attempt,
            })
        );
      }),
    },
    progress: {
      commit: vi.fn(async (input) => reduceE2EProgress(input.expected, input.transition)),
    },
    createVerificationRunId: (nextAttempt) => `verification-run-${nextAttempt}`,
    createSessionIdentity: ({ attempt: nextAttempt }) => ({
      attemptId: `e2e-attempt-${nextAttempt}`,
      conversationId: `e2e-conversation-${nextAttempt}`,
    }),
    now: () => new Date('2026-07-12T01:02:03.000Z'),
  };

  return { gate: new CleanRoomE2EGate(dependencies), dependencies, calls };
}

function requiredChecksResult(input: {
  loopId?: string;
  phaseId?: string;
  target: LoopSessionTarget;
  checkpointCommit: string;
  verificationRunId: string;
  outerConversationId: string;
  validationCommands?: readonly string[];
  criteria?: readonly LoopPhaseCriterion[];
  taskEnvironment: Readonly<Record<string, string>>;
  attempt?: number;
  status?: 'passed' | 'correctable' | 'failed';
}): E2ERequiredChecksResult {
  const status = input.status ?? 'passed';
  return {
    status,
    loopId: input.loopId ?? loop.id,
    phaseId: input.phaseId ?? phase.id,
    fullChecksRan: true,
    verificationRunId: input.verificationRunId,
    attempt: input.attempt ?? 1,
    outerConversationId: input.outerConversationId,
    target: input.target,
    executionTarget: input.target,
    checkpointCommit: input.checkpointCommit,
    provider: 'codex',
    model: 'gpt-5.6-sol',
    validationCommands: input.validationCommands ?? VALIDATION_COMMANDS,
    criteria: input.criteria ?? E2E_CRITERIA,
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

type TargetEchoPort =
  | 'binding'
  | 'session'
  | 'prompt'
  | 'checks'
  | 'native'
  | 'nested'
  | 'cancel'
  | 'release'
  | 'final';

function arrangeWhitespaceTargetEcho(
  harness: Harness,
  port: TargetEchoPort,
  cleanTarget: LoopSessionTarget,
  feature: LoopSessionTarget
): void {
  const cleanAlias = whitespaceAlias(cleanTarget);
  switch (port) {
    case 'binding': {
      const acquire = vi.mocked(harness.dependencies.execution.acquire);
      const original = acquire.getMockImplementation()!;
      acquire.mockImplementationOnce(async (input) => {
        const result = await original(input);
        if (!result.success) return result;
        return ok({
          ...result.data,
          target: cleanAlias,
          executionTarget: {
            ...result.data.executionTarget,
            ...cleanAlias,
          },
        });
      });
      return;
    }
    case 'session': {
      const start = vi.mocked(harness.dependencies.session.startFreshE2ESession);
      const original = start.getMockImplementation()!;
      start.mockImplementationOnce(async (input) => {
        const result = await original(input);
        return result.success ? ok({ ...result.data, target: cleanAlias }) : result;
      });
      return;
    }
    case 'prompt': {
      const prompt = vi.mocked(harness.dependencies.session.sendE2EPrompt);
      const original = prompt.getMockImplementation()!;
      prompt.mockImplementationOnce(async (input) => {
        const result = await original(input);
        return result.success ? ok({ ...result.data, target: cleanAlias }) : result;
      });
      return;
    }
    case 'checks':
      mutateRequiredChecksOnce(harness, (result) => ({
        ...result,
        target: cleanAlias,
        executionTarget: cleanAlias,
      }));
      return;
    case 'native':
      mutateRequiredChecksOnce(harness, (result) => ({
        ...result,
        nativePreview: { ...result.nativePreview, target: cleanAlias },
      }));
      return;
    case 'nested':
      mutateRequiredChecksOnce(harness, (result) => ({
        ...result,
        sessionAttempts: [{ ...result.sessionAttempts[0]!, target: cleanAlias }],
      }));
      return;
    case 'cancel': {
      const cancel = vi.mocked(harness.dependencies.session.cancelE2ESession);
      const original = cancel.getMockImplementation()!;
      cancel.mockImplementationOnce(async (input) => {
        const result = await original(input);
        return result.success ? ok({ ...result.data, target: cleanAlias }) : result;
      });
      return;
    }
    case 'release': {
      const release = vi.mocked(harness.dependencies.execution.release);
      const original = release.getMockImplementation()!;
      release.mockImplementationOnce(async (input) => {
        const result = await original(input);
        return result.success ? ok({ ...result.data, target: cleanAlias }) : result;
      });
      return;
    }
    case 'final':
      vi.mocked(harness.dependencies.authority.inspectFeature).mockResolvedValueOnce(
        ok({
          target: whitespaceAlias(feature),
          headCommit: FEATURE_COMMIT,
          clean: true,
          branchAttached: true,
        })
      );
  }
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
        intermediateFailures: [{ source: 'Clean-room E2E correction' }],
        stageResult: { status: 'failed' },
      },
    });
    expect(harness.calls).not.toContain('checks:1');
    expect(harness.calls).toContain('destroy:1');
    expect(harness.dependencies.authority.inspectFeature).toHaveBeenCalledOnce();
    expect(vi.mocked(harness.dependencies.authority.inspectFeature).mock.calls[0]?.[0]).toEqual({
      target: featureTarget,
      expectedFeatureHead: FIX_COMMIT,
    });
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
        loop: loopWithTerminalGates(terminalGates),
        terminalGates,
        reviewStageResult,
      });

      expect(result).toMatchObject({ success: false, error: { type, stage: 'precondition' } });
      expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
    }
  );

  it('accepts E2E-only ordering when Review is disabled and no Review result exists', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);

    const result = await harness.gate.run({
      ...defaultInput,
      loop: loopWithTerminalGates({ review: false, e2e: true }),
      terminalGates: { review: false, e2e: true },
      reviewStageResult: undefined,
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
      'execution-target-drift',
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
        type: 'integration-authority-invalid',
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
        type: 'feature-authority-invalid',
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
        type: 'stale-conversation',
        stage: 'session-start',
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
    if (result.success) throw new Error('Expected stale session rejection.');
    expect(result.error.sessionAttempts).toHaveLength(1);
    expect(result.error.sessionAttempts[0]).not.toMatchObject({
      attemptId: 'work-attempt-1',
      conversationId: 'work-1',
    });
    expect(harness.dependencies.session.cancelE2ESession).toHaveBeenCalledOnce();
    expect(harness.dependencies.execution.release).toHaveBeenCalledOnce();
    expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledOnce();
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
      error: { type: 'native-verifier-ledger-invalid', stage: 'required-checks' },
    });
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
    expect(harness.dependencies.authority.inspectFeature).toHaveBeenCalledOnce();
    expect(vi.mocked(harness.dependencies.authority.inspectFeature).mock.calls[0]?.[0]).toEqual({
      target: featureTarget,
      expectedFeatureHead: FIX_COMMIT,
    });
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
    expect(harness.dependencies.authority.inspectFeature).toHaveBeenCalledOnce();
    expect(vi.mocked(harness.dependencies.authority.inspectFeature).mock.calls[0]?.[0]).toEqual({
      target: featureTarget,
      expectedFeatureHead: FIX_COMMIT,
    });
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
    const target = {
      workspaceId: 'verification-workspace-1',
      path: '/tmp/verification-workspace-1',
      machine: { kind: 'local' as const },
    };
    const nested = requiredChecksResult({
      target,
      checkpointCommit: FEATURE_COMMIT,
      verificationRunId: 'verification-run-1',
      outerConversationId: 'e2e-conversation-1',
      taskEnvironment: environment(target),
    }).sessionAttempts;
    vi.mocked(harness.dependencies.requiredChecks.run).mockResolvedValueOnce(
      err({ message: 'checks rejected after nested verification', sessionAttempts: nested })
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

  it('fails closed when uncontrolled authority drifts immediately after integration', async () => {
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
        stage: 'finalize',
        featureHead: concurrentHead,
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
      maxAttempts: 1,
    });

    expect(result).toMatchObject({
      success: false,
      error: { type: 'invalid-input', stage: 'precondition', attempt: 0 },
    });
    expect(harness.dependencies.cleanRoom.create).not.toHaveBeenCalled();
  });

  it('rejects historical verification-run ID reuse before clean-room creation', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    if (!loop.state || loop.state.version !== '1') throw new Error('Expected Loop state fixture.');
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

  it('retains fresh terminal nested attempts from a quiesced required-check rejection', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const terminalAttempts = [
      nestedAttempt({
        attemptId: 'nested-failed',
        conversationId: 'nested-failed-conversation',
        status: 'failed',
        error: 'native assertion failed',
      }),
      nestedAttempt({
        attemptId: 'nested-cancelled',
        conversationId: 'nested-cancelled-conversation',
        status: 'cancelled',
        error: 'native assertion cancelled',
      }),
      nestedAttempt({
        attemptId: 'nested-interrupted',
        conversationId: 'nested-interrupted-conversation',
        status: 'interrupted',
        error: 'native assertion interrupted',
      }),
    ];
    vi.mocked(harness.dependencies.requiredChecks.run).mockResolvedValueOnce(
      err({
        message: 'checks settled with terminal browser attempts',
        sessionAttempts: [
          ...terminalAttempts,
          nestedAttempt({
            attemptId: 'work-attempt-1',
            conversationId: 'historical-duplicate',
            status: 'failed',
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
          { attemptId: 'nested-failed', status: 'failed' },
          { attemptId: 'nested-cancelled', status: 'cancelled' },
          { attemptId: 'nested-interrupted', status: 'interrupted' },
        ],
      },
    });
    if (result.success) throw new Error('Expected required-check rejection.');
    expect(result.error.sessionAttempts.map((attempt) => attempt.attemptId)).not.toContain(
      'work-attempt-1'
    );
  });

  it('normalizes fresh nonterminal nested attempts to interrupted after checks quiesce', async () => {
    const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }]);
    const running = nestedAttempt({
      attemptId: 'nested-running',
      conversationId: 'nested-running-conversation',
      status: 'running',
    });
    const starting = nestedAttempt({
      attemptId: 'nested-starting',
      conversationId: 'nested-starting-conversation',
      status: 'starting',
    });
    delete running.finishedAt;
    delete starting.finishedAt;
    vi.mocked(harness.dependencies.requiredChecks.run).mockResolvedValueOnce(
      err({
        message: 'checks quiesced while nested attempts were nonterminal',
        sessionAttempts: [running, starting],
      })
    );

    const result = await harness.gate.run(defaultInput);

    expect(result).toMatchObject({
      success: false,
      error: {
        stage: 'required-checks',
        sessionAttempts: [
          { purpose: 'e2e', status: 'failed' },
          { attemptId: 'nested-running', status: 'interrupted' },
          { attemptId: 'nested-starting', status: 'interrupted' },
        ],
      },
    });
    if (result.success) throw new Error('Expected required-check rejection.');
    expect(result.error.sessionAttempts.slice(1).every((attempt) => attempt.finishedAt)).toBe(true);
  });

  it('passes a current retry checkpoint, state, ledger, and one normalized command list to checks', async () => {
    const rawValidationCommands = ['  pnpm run test  ', '\tpnpm run typecheck\n'];
    const normalizedValidationCommands = ['pnpm run test', 'pnpm run typecheck'];
    const retryLoop = loopWithConfig({ validationCommands: rawValidationCommands });
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
    expect(received?.authority.progress.loopState.sessionAttempts.slice(-2)).toMatchObject([
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
            target: cleanTargetFor(featureTarget, 2),
            checkpointCommit: FIX_COMMIT,
            verificationRunId: 'verification-run-2',
            outerConversationId: 'e2e-conversation-2',
            taskEnvironment: environment(cleanTargetFor(featureTarget, 2)),
            attempt: 2,
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

    const result = await harness.gate.run({ ...defaultInput, maxAttempts: 2 });
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

  const targetEchoMachines = [
    { name: 'local', target: featureTarget, inputProject: project },
    {
      name: 'SSH',
      target: sshFeatureTarget,
      inputProject: {
        ...project,
        defaultWorkspaceMachine: sshFeatureTarget.machine,
      } as unknown as CleanRoomProject,
    },
  ] as const;
  const targetEchoPorts = [
    {
      port: 'binding',
      errorType: 'execution-target-drift',
      stage: 'execution',
      releaseCount: 0,
      destroyCount: 0,
      destroyed: false,
    },
    {
      port: 'session',
      errorType: 'session-authority-invalid',
      stage: 'session-start',
      releaseCount: 1,
      destroyCount: 1,
      destroyed: true,
    },
    {
      port: 'prompt',
      errorType: 'prompt-authority-invalid',
      stage: 'prompt',
      releaseCount: 1,
      destroyCount: 1,
      destroyed: true,
    },
    {
      port: 'checks',
      errorType: 'required-checks-authority-invalid',
      stage: 'required-checks',
      releaseCount: 1,
      destroyCount: 1,
      destroyed: true,
    },
    {
      port: 'native',
      errorType: 'native-verifier-authority-invalid',
      stage: 'required-checks',
      releaseCount: 1,
      destroyCount: 1,
      destroyed: true,
    },
    {
      port: 'nested',
      errorType: 'native-verifier-ledger-invalid',
      stage: 'required-checks',
      releaseCount: 1,
      destroyCount: 1,
      destroyed: true,
    },
    {
      port: 'cancel',
      errorType: 'dependency-rejected',
      stage: 'quiescence',
      releaseCount: 0,
      destroyCount: 0,
      destroyed: false,
    },
    {
      port: 'release',
      errorType: 'cleanup-failed',
      stage: 'cleanup',
      releaseCount: 1,
      destroyCount: 0,
      destroyed: false,
    },
    {
      port: 'final',
      errorType: 'feature-head-drift',
      stage: 'finalize',
      releaseCount: 1,
      destroyCount: 1,
      destroyed: true,
    },
  ] as const satisfies readonly {
    port: TargetEchoPort;
    errorType: string;
    stage: string;
    releaseCount: number;
    destroyCount: number;
    destroyed: boolean;
  }[];

  for (const machine of targetEchoMachines) {
    for (const expectation of targetEchoPorts) {
      it(`rejects a whitespace-normalized ${machine.name} ${expectation.port} target echo`, async () => {
        const harness = makeHarness([{ finalText: '<<<LOOP:E2E_PASSED>>>' }], machine.target);
        arrangeWhitespaceTargetEcho(
          harness,
          expectation.port,
          cleanTargetFor(machine.target),
          machine.target
        );

        const result = await harness.gate.run({
          ...defaultInput,
          project: machine.inputProject,
          featureTarget: machine.target,
        });

        expect(result).toMatchObject({
          success: false,
          error: {
            type: expectation.errorType,
            stage: expectation.stage,
            lastWorkspaceDestroyed: expectation.destroyed,
          },
        });
        expect(harness.dependencies.execution.release).toHaveBeenCalledTimes(
          expectation.releaseCount
        );
        expect(harness.dependencies.cleanRoom.destroy).toHaveBeenCalledTimes(
          expectation.destroyCount
        );
      });
    }
  }
});
