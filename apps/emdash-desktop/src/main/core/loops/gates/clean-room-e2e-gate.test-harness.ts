import { vi } from 'vitest';
import { getTaskEnvVars } from '@main/core/workspaces/workspace-env';
import { err, ok } from '@main/lib/result';
import type {
  LoopSessionAttempt,
  LoopSessionTarget,
  LoopStateV2,
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
import { reduceE2EProgress, type E2EDurableProgress } from './clean-room-e2e-progress';

export const BASE_COMMIT = '1'.repeat(40);
export const FEATURE_COMMIT = '2'.repeat(40);
export const FIX_COMMIT = '3'.repeat(40);
export const VALIDATION_COMMANDS = ['pnpm run test', 'pnpm run typecheck'] as const;
export const E2E_CRITERIA = [
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

export const featureTarget: LoopSessionTarget = {
  workspaceId: 'feature-workspace',
  path: '/tmp/feature-workspace',
  machine: { kind: 'local' },
};

export const sshFeatureTarget: LoopSessionTarget = {
  workspaceId: 'feature-workspace-ssh',
  path: '/srv/emdash/feature-workspace',
  machine: { kind: 'ssh', connectionId: 'ssh-production' },
};

export const loop: Loop = {
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
    version: '2',
    baseCommit: BASE_COMMIT,
    expectedFeatureHead: FEATURE_COMMIT,
    checkpointCommit: FEATURE_COMMIT,
    e2eAttemptsConsumed: 0,
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

export const phase: LoopPhase = {
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

export const passedStage = {
  status: 'passed' as const,
  summary: 'Passed.',
  completedAt: '2026-07-12T00:30:00.000Z',
};

export function prerequisitePhases(reviewEnabled: boolean): LoopPhase[] {
  const makePhase = (
    id: string,
    idx: number,
    kind: 'work' | 'review',
    conversationId: string
  ): LoopPhase => ({
    id,
    loopId: loop.id,
    idx,
    name: kind === 'review' ? 'Terminal Review' : `Work ${idx + 1}`,
    goal: kind === 'review' ? 'Review the complete change.' : 'Implement the requested change.',
    status: 'passed',
    attempts: 1,
    conversationId,
    criteria: { version: '1', criteria: [] },
    lastError: null,
    kind,
    state: {
      version: '2',
      checkpointCommit: FEATURE_COMMIT,
      handoff: null,
      retryHandoffs: [],
      result: passedStage,
    },
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:15:00.000Z',
  });
  return reviewEnabled
    ? [
        makePhase('phase-work-1', 0, 'work', 'work-1'),
        makePhase('phase-review', 1, 'review', 'review-1'),
      ]
    : [
        makePhase('phase-work-1', 0, 'work', 'work-1'),
        makePhase('phase-work-2', 1, 'work', 'work-2'),
      ];
}

export const project = {
  projectId: loop.projectId,
  repoPath: '/tmp/project',
  ctx: {} as CleanRoomProject['ctx'],
  defaultWorkspaceMachine: { kind: 'local' },
  defaultWorkspaceType: 'worktree',
  worktreeService: {} as CleanRoomProject['worktreeService'],
  settings: {
    getDefaultBranch: vi.fn(async () => 'main'),
  } as unknown as CleanRoomProject['settings'],
  gitRepository: {} as CleanRoomProject['gitRepository'],
  gitRepositoryFetchService: {} as CleanRoomProject['gitRepositoryFetchService'],
} as unknown as CleanRoomProject;

export function environment(target: LoopSessionTarget): Readonly<Record<string, string>> {
  return getTaskEnvVars({
    taskId: loop.taskId,
    taskName: 'Loop task',
    taskPath: target.path,
    projectPath: project.repoPath,
    defaultBranch: 'main',
    portSeed: target.path,
  });
}

export const defaultInput: RunCleanRoomE2EGateInput = {
  loop,
  phase,
  task: { id: loop.taskId, name: 'Loop task' },
  project,
  featureTarget,
  provider: 'codex',
  model: 'gpt-5.6-sol',
  terminalGates: { review: true, e2e: true },
  goal: 'Finish ACP Loops v2.',
  acceptanceCriteria: ['The clean-room result is independently green.'],
  baseCommit: BASE_COMMIT,
  checkpointCommit: FEATURE_COMMIT,
  handoffs: [],
  intermediateFailures: [],
};

export function loopWithTerminalGates(terminalGates: { review: boolean; e2e: boolean }): Loop {
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

export function loopWithConfig(overrides: Partial<LoopConfigV2>): Loop {
  if (loop.config?.version !== '2') throw new Error('Expected a v2 Loop test fixture.');
  return { ...loop, config: { ...loop.config, ...overrides } };
}

export function loopWithState(overrides: Partial<LoopStateV2>): Loop {
  if (!loop.state || loop.state.version !== '2') {
    throw new Error('Expected a v2 Loop state test fixture.');
  }
  return { ...loop, state: { ...loop.state, ...overrides } };
}

export function cleanTargetFor(target: LoopSessionTarget, attempt = 1): LoopSessionTarget {
  return {
    workspaceId: `verification-workspace-${attempt}`,
    path:
      target.machine.kind === 'local'
        ? `/tmp/verification-workspace-${attempt}`
        : `/srv/emdash/verification-workspace-${attempt}`,
    machine: { ...target.machine },
  };
}

export function whitespaceAlias(target: LoopSessionTarget): LoopSessionTarget {
  return {
    workspaceId: ` ${target.workspaceId} `,
    path: ` ${target.path} `,
    machine:
      target.machine.kind === 'local'
        ? { kind: 'local' }
        : { kind: 'ssh', connectionId: ` ${target.machine.connectionId} ` },
  };
}

export function makePendingCleanup(
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

export function historicalAttempts(count: number): LoopSessionAttempt[] {
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

export function historicalE2EAttempt(ordinal: number): LoopSessionAttempt {
  return {
    attemptId: `historical-e2e-attempt-${ordinal}`,
    conversationId: `historical-e2e-conversation-${ordinal}`,
    purpose: 'e2e',
    phaseId: phase.id,
    verificationRunId: `historical-verification-run-${ordinal}`,
    target: cleanTargetFor(featureTarget, ordinal),
    status: 'interrupted',
    checkpointBefore: FEATURE_COMMIT,
    startedAt: '2026-07-12T00:20:00.000Z',
    finishedAt: '2026-07-12T00:21:00.000Z',
    error: 'The prior process stopped before terminal persistence.',
  };
}

export function nestedAttempt(
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
    startedAt: '2026-07-12T01:03:00.000Z',
    finishedAt: '2026-07-12T01:04:00.000Z',
    ...overrides,
  };
}

export type AttemptScript = {
  finalText: string;
  postHead?: string;
  mutated?: boolean;
  clean?: boolean;
  checks?: E2ERequiredChecksResult;
};

export type Harness = {
  gate: CleanRoomE2EGate;
  dependencies: CleanRoomE2EGateDependencies;
  calls: string[];
};

export function makeHarness(scripts: readonly AttemptScript[], target = featureTarget): Harness {
  const calls: string[] = [];
  let attempt = 0;
  let inspectCount = 0;
  let acceptedFeatureHead = FEATURE_COMMIT;
  let activeTarget: LoopSessionTarget | undefined;
  let durableProgress: E2EDurableProgress | undefined;
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
        const sessionIdentity =
          'sessionIdentity' in input &&
          input.sessionIdentity &&
          typeof input.sessionIdentity === 'object'
            ? (input.sessionIdentity as { attemptId: string; conversationId: string })
            : undefined;
        const adoptedScript =
          scripted && sessionIdentity && scripted.sessionAttempts.length === 1
            ? {
                ...scripted,
                sessionAttempts: [{ ...scripted.sessionAttempts[0]!, ...sessionIdentity }],
              }
            : scripted;
        return ok(
          adoptedScript ??
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
              sessionIdentity,
            })
        );
      }),
    },
    prerequisites: {
      resolve: vi.fn(async (input) =>
        ok({ phases: prerequisitePhases(input.terminalGates.review) })
      ),
    },
    progress: {
      read: vi.fn(async () =>
        durableProgress ? ok(durableProgress) : err({ message: 'No durable progress snapshot.' })
      ),
      commit: vi.fn(async (input) => {
        const reduced = reduceE2EProgress(input.expected, input.transition);
        if (reduced.success) durableProgress = reduced.data;
        return reduced;
      }),
    },
    createVerificationRunId: (nextAttempt) => `verification-run-${nextAttempt}`,
    createSessionIdentity: (input) => {
      const purpose = 'purpose' in input ? input.purpose : 'e2e';
      return purpose === 'browser-verification'
        ? {
            attemptId: `browser-verification-run-${input.attempt}`,
            conversationId: `browser-conversation-run-${input.attempt}`,
          }
        : {
            attemptId: `e2e-attempt-${input.attempt}`,
            conversationId: `e2e-conversation-${input.attempt}`,
          };
    },
    now: () => new Date('2026-07-12T01:02:03.000Z'),
  };

  return { gate: new CleanRoomE2EGate(dependencies), dependencies, calls };
}

export function requiredChecksResult(input: {
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
  sessionIdentity?: { attemptId: string; conversationId: string };
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
    nativeEvidence: {
      runId: input.verificationRunId,
      artifacts: [],
    },
    sessionAttempts: [
      {
        attemptId: input.sessionIdentity?.attemptId ?? `browser-${input.verificationRunId}`,
        conversationId:
          input.sessionIdentity?.conversationId ??
          `browser-conversation-${input.verificationRunId}`,
        purpose: 'browser-verification',
        phaseId: phase.id,
        verificationRunId: input.verificationRunId,
        target: input.target,
        status: 'completed',
        checkpointBefore: input.checkpointCommit,
        checkpointAfter: input.checkpointCommit,
        startedAt: '2026-07-12T01:03:00.000Z',
        finishedAt: '2026-07-12T01:04:00.000Z',
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

export function mutateRequiredChecksOnce(
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

export type TargetEchoPort =
  | 'binding'
  | 'session'
  | 'prompt'
  | 'checks'
  | 'native'
  | 'nested'
  | 'cancel'
  | 'release'
  | 'final';

export function arrangeWhitespaceTargetEcho(
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
