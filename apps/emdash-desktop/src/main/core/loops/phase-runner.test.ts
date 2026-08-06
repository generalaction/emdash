import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@main/lib/result';
import type { Loop, LoopPhase, LoopWithPhases } from '@shared/core/loops/loops';
import type { LoopSessionDriver } from './drivers/session-driver';
import { MAX_PHASE_ATTEMPTS, PhaseRunner, type LoopRunControl } from './phase-runner';
import { PHASE_DONE_SENTINEL } from './prompt-builder';
import type { LoopExecutionTarget } from './runtime/loop-execution-target';
import type { BuiltInVerifierId, LoopVerifier, VerifierError } from './verifiers/types';

vi.mock('./operations/loop-operations', () => ({
  getLoop: vi.fn(),
  updateLoop: vi.fn(),
  updatePhase: vi.fn(),
}));

vi.mock('./operations/session-progress', () => ({ commitSessionAttempt: vi.fn() }));
vi.mock('./operations/work-phase-progress', () => ({ commitWorkPhaseProgress: vi.fn() }));
vi.mock('./operations/terminal-phase-progress', () => ({
  commitTerminalPhaseFailure: vi.fn(),
  commitTerminalPhaseSuccess: vi.fn(),
}));

function makeLoop(): LoopWithPhases {
  const loop: Loop = {
    id: 'loop-1',
    projectId: 'project-1',
    taskId: 'task-1',
    name: 'Loop',
    slug: 'loop',
    status: 'running',
    currentPhaseIndex: 0,
    config: {
      version: '1',
      verifiers: ['gh'],
      reviewEnabled: false,
      validationCommands: ['pnpm run test'],
      planSource: 'plan.md',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const phase: LoopPhase = {
    id: 'phase-1',
    loopId: loop.id,
    idx: 0,
    name: 'Phase',
    goal: 'Do the work',
    status: 'pending',
    attempts: 0,
    conversationId: null,
    criteria: {
      version: '1',
      criteria: [{ description: 'CI green', verifier: 'gh', status: 'pending' }],
    },
    lastError: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return { ...loop, phases: [phase] };
}

function makeControl(): LoopRunControl {
  return {
    signal: new AbortController().signal,
    stopReason: () => null,
    setActiveConversation: vi.fn(),
  };
}

function makeExecutionTarget(): LoopExecutionTarget {
  return {
    workspaceId: 'workspace-1',
    path: '/tmp/workspace',
    machine: { kind: 'local' as const },
    taskEnv: { EMDASH_TASK_ID: 'task-1', EMDASH_TASK_PATH: '/tmp/workspace' },
    executionContext: {
      root: '/tmp/workspace',
      supportsLocalSpawn: true,
      exec: vi.fn(),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    },
    dispose: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function makeV2Loop(): LoopWithPhases {
  const base = '1'.repeat(40);
  const loop = makeLoop();
  return {
    ...loop,
    config: {
      version: '2',
      provider: 'codex',
      model: 'gpt-5.6-sol',
      validationCommands: ['pnpm test'],
      planSource: '# Plan',
      terminalGates: { review: false, e2e: false },
      browserPreview: { enabled: false },
      reviewEnabled: false,
      verifiers: [],
    },
    isPrimary: true,
    state: {
      version: '2',
      baseCommit: base,
      expectedFeatureHead: base,
      checkpointCommit: base,
      e2eAttemptsConsumed: 0,
      sessionAttempts: [],
      verification: null,
    },
    phases: loop.phases.map((phase) => ({
      ...phase,
      kind: 'work' as const,
      state: {
        version: '2' as const,
        checkpointCommit: null,
        handoff: null,
        retryHandoffs: [],
        result: null,
      },
    })),
  };
}

function makeMemoryDeps(loop: LoopWithPhases, verifiers: Map<BuiltInVerifierId, LoopVerifier>) {
  let current = loop;
  const loopTransitions: string[] = [];
  const phaseTransitions: string[] = [];

  return {
    deps: {
      getLoop: vi.fn(async () => current),
      updateLoop: vi.fn(async (_loopId: string, patch: Partial<Loop>) => {
        current = { ...current, ...patch };
        if (patch.status) loopTransitions.push(patch.status);
        return ok(current);
      }),
      updatePhase: vi.fn(async (phaseId: string, patch: Partial<LoopPhase>) => {
        current = {
          ...current,
          phases: current.phases.map((phase) =>
            phase.id === phaseId ? { ...phase, ...patch } : phase
          ),
        };
        const phase = current.phases.find((candidate) => candidate.id === phaseId)!;
        if (patch.status) phaseTransitions.push(patch.status);
        return ok(phase);
      }),
      getVerifier: (id: BuiltInVerifierId) => verifiers.get(id),
      getDiff: vi.fn(async () => 'diff --git a/a.ts b/a.ts\n+change'),
    },
    current: () => current,
    loopTransitions,
    phaseTransitions,
  };
}

function passingVerifier(id: BuiltInVerifierId): LoopVerifier {
  return {
    id,
    label: id,
    checkAvailability: vi.fn(async () => ok({ available: true })),
    run: vi.fn(async (ctx) =>
      ok({
        verifierId: id,
        label: id,
        command: id,
        cwd: ctx.cwd,
        durationMs: 1,
        stdoutTail: '',
        stderrTail: '',
        exitCode: 0,
        summary: `${id} passed`,
      })
    ),
  };
}

function failingVerifier(id: BuiltInVerifierId, error: VerifierError): LoopVerifier {
  return {
    id,
    label: id,
    checkAvailability: vi.fn(async () => ok({ available: true })),
    run: vi.fn(async () => err(error)),
  };
}

describe('PhaseRunner', () => {
  let loop: LoopWithPhases;
  let driver: LoopSessionDriver;

  beforeEach(() => {
    loop = makeLoop();
    driver = {
      kind: 'acp',
      startPhaseSession: vi.fn(async () => ok({ conversationId: 'conv-1', title: 'loop-1' })),
      startVerificationSession: vi.fn(async () =>
        ok({ conversationId: 'conv-verify', title: 'loop-1-verify' })
      ),
      sendPrompt: vi.fn(async () => ok({ finalText: `Done\n${PHASE_DONE_SENTINEL}` })),
      cancelPrompt: vi.fn(async () => ok(undefined)),
    };
  });

  it('passes a phase after done sentinel and green verifier gate', async () => {
    const gh = passingVerifier('gh');
    const verifiers = new Map<BuiltInVerifierId, LoopVerifier>([
      ['unit-tests', passingVerifier('unit-tests')],
      ['gh', gh],
    ]);
    const memory = makeMemoryDeps(loop, verifiers);

    const result = await new PhaseRunner({
      ...memory.deps,
      verifierPromptTimeoutMs: 123,
    }).runPhase({
      loop,
      phase: loop.phases[0]!,
      executionTarget: makeExecutionTarget(),
      driver,
      control: makeControl(),
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.kind).toBe('passed');
    expect(memory.phaseTransitions).toEqual(['running', 'verifying', 'passed']);
    expect(driver.startPhaseSession).toHaveBeenCalledTimes(1);
    const unitTestsOrder = vi.mocked(verifiers.get('unit-tests')!.run).mock.invocationCallOrder[0]!;
    const ghOrder = vi.mocked(verifiers.get('gh')!.run).mock.invocationCallOrder[0]!;
    expect(unitTestsOrder).toBeLessThan(ghOrder);
    expect(gh.run).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionDriver: driver,
        promptTimeoutMs: 123,
      })
    );
  });

  it('persists complete verifier evidence with a non-empty summary fallback', async () => {
    const gh = passingVerifier('gh');
    vi.mocked(gh.run).mockResolvedValueOnce(
      ok({
        verifierId: 'gh',
        label: 'GitHub checks',
        command: 'gh pr checks',
        cwd: '/tmp/workspace',
        durationMs: 42,
        stdoutTail: 'checks passed',
        stderrTail: '',
        exitCode: 0,
        summary: '',
      })
    );
    const verifiers = new Map<BuiltInVerifierId, LoopVerifier>([
      ['unit-tests', passingVerifier('unit-tests')],
      ['gh', gh],
    ]);
    const memory = makeMemoryDeps(loop, verifiers);

    const result = await new PhaseRunner(memory.deps).runPhase({
      loop,
      phase: loop.phases[0]!,
      executionTarget: makeExecutionTarget(),
      driver,
      control: makeControl(),
    });

    expect(result.success).toBe(true);
    const evidence = memory.current().phases[0]?.criteria?.criteria[0]?.evidence;
    expect(evidence).toBeDefined();
    const parsed = JSON.parse(evidence! as string) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      summary: 'checks passed',
      command: 'gh pr checks',
      exitCode: 0,
      durationMs: 42,
    });
  });

  it('retries verifier failures in the same conversation', async () => {
    const ghError: VerifierError = {
      kind: 'command-failed',
      verifierId: 'gh',
      message: 'checks failed',
    };
    const gh = failingVerifier('gh', ghError);
    vi.mocked(gh.run)
      .mockResolvedValueOnce(err(ghError))
      .mockResolvedValueOnce(
        ok({
          verifierId: 'gh',
          label: 'gh',
          command: 'gh',
          cwd: '/tmp/workspace',
          durationMs: 1,
          stdoutTail: '',
          stderrTail: '',
          exitCode: 0,
          summary: 'gh passed',
        })
      );

    const verifiers = new Map<BuiltInVerifierId, LoopVerifier>([
      ['unit-tests', passingVerifier('unit-tests')],
      ['gh', gh],
    ]);
    const memory = makeMemoryDeps(loop, verifiers);

    const result = await new PhaseRunner(memory.deps).runPhase({
      loop,
      phase: loop.phases[0]!,
      executionTarget: makeExecutionTarget(),
      driver,
      control: makeControl(),
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.kind).toBe('passed');
    expect(driver.startPhaseSession).toHaveBeenCalledTimes(1);
    expect(driver.sendPrompt).toHaveBeenCalledTimes(2);
    expect(memory.current().phases[0]?.attempts).toBe(2);
    expect(memory.current().phases[0]?.conversationId).toBe('conv-1');
  });

  it('fails a phase after the maximum attempts', async () => {
    const ghError: VerifierError = {
      kind: 'command-failed',
      verifierId: 'gh',
      message: 'checks failed',
    };
    const verifiers = new Map<BuiltInVerifierId, LoopVerifier>([
      ['unit-tests', passingVerifier('unit-tests')],
      ['gh', failingVerifier('gh', ghError)],
    ]);
    const memory = makeMemoryDeps(loop, verifiers);

    const result = await new PhaseRunner(memory.deps).runPhase({
      loop,
      phase: loop.phases[0]!,
      executionTarget: makeExecutionTarget(),
      driver,
      control: makeControl(),
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.kind).toBe('failed');
    expect(memory.current().phases[0]?.attempts).toBe(MAX_PHASE_ATTEMPTS);
    expect(memory.current().phases[0]?.status).toBe('failed');
    expect(memory.current().status).toBe('failed');
  });

  it('cancels and fails attempts when a prompt exceeds the configured timeout', async () => {
    const verifiers = new Map<BuiltInVerifierId, LoopVerifier>([
      ['unit-tests', passingVerifier('unit-tests')],
      ['gh', passingVerifier('gh')],
    ]);
    const memory = makeMemoryDeps(loop, verifiers);
    driver.sendPrompt = vi.fn(
      (): ReturnType<LoopSessionDriver['sendPrompt']> => new Promise(() => {})
    );
    driver.cancelPrompt = vi.fn(async () => ok(undefined));

    const result = await new PhaseRunner({
      ...memory.deps,
      promptTimeoutMs: 1,
    }).runPhase({
      loop,
      phase: loop.phases[0]!,
      executionTarget: makeExecutionTarget(),
      driver,
      control: makeControl(),
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.kind).toBe('failed');
    expect(driver.sendPrompt).toHaveBeenCalledTimes(MAX_PHASE_ATTEMPTS);
    expect(driver.cancelPrompt).toHaveBeenCalledTimes(MAX_PHASE_ATTEMPTS);
    expect(memory.current().phases[0]?.lastError).toBe('Loop prompt timed out after 1s.');
    expect(memory.current().phases[0]?.lastError).not.toBe('undefined');
  });

  it('does not persist literal undefined from prompt failures', async () => {
    const verifiers = new Map<BuiltInVerifierId, LoopVerifier>([
      ['unit-tests', passingVerifier('unit-tests')],
      ['gh', passingVerifier('gh')],
    ]);
    const memory = makeMemoryDeps(loop, verifiers);
    driver.sendPrompt = vi.fn(
      (): ReturnType<LoopSessionDriver['sendPrompt']> =>
        Promise.resolve(err({ kind: 'prompt-failed' as const, message: 'undefined' }))
    );

    const result = await new PhaseRunner(memory.deps).runPhase({
      loop,
      phase: loop.phases[0]!,
      executionTarget: makeExecutionTarget(),
      driver,
      control: makeControl(),
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.kind).toBe('failed');
    expect(memory.current().phases[0]?.lastError).toBe('Loop prompt failed');
  });

  it('runs a v2 work phase in one fresh targeted session and atomically checkpoints it', async () => {
    loop = makeV2Loop();
    const memory = makeMemoryDeps(loop, new Map([['unit-tests', passingVerifier('unit-tests')]]));
    const commitSessionAttempt = vi.fn(async (input) => {
      const attempts = [...input.expected.sessionAttempts];
      if (input.previous) {
        attempts[attempts.findIndex((attempt) => attempt.attemptId === input.previous.attemptId)] =
          input.next;
      } else {
        attempts.push(input.next);
      }
      return ok({ ...input.expected, sessionAttempts: attempts });
    });
    const checkpoint = '2'.repeat(40);
    const commitWorkPhaseProgress = vi.fn(async (input) =>
      ok({
        loop: {
          ...loop,
          state: {
            ...input.expectedLoopState,
            checkpointCommit: checkpoint,
            expectedFeatureHead: checkpoint,
          },
        },
        phase: { ...loop.phases[0]!, status: 'passed' as const },
      })
    );
    const exec = vi.fn(async (_command: string, args?: string[]) => ({
      stdout:
        args?.[0] === 'status'
          ? ' M src/file.ts\n'
          : args?.[0] === 'rev-parse'
            ? `${checkpoint}\n`
            : '',
      stderr: '',
    }));
    const executionTarget = {
      ...makeExecutionTarget(),
      executionContext: {
        root: '/tmp/workspace',
        supportsLocalSpawn: true,
        exec,
        execStreaming: vi.fn(),
        dispose: vi.fn(),
      },
    };
    driver.sendPrompt = vi.fn(async () =>
      ok({ finalText: `Implemented with tests.\n${PHASE_DONE_SENTINEL}` })
    );

    const result = await new PhaseRunner({
      ...memory.deps,
      commitSessionAttempt: commitSessionAttempt as never,
      commitWorkPhaseProgress: commitWorkPhaseProgress as never,
      now: () => new Date('2026-07-12T00:00:00.000Z'),
    }).runPhase({
      loop,
      phase: loop.phases[0]!,
      executionTarget,
      driver,
      control: makeControl(),
    });

    expect(result.success && result.data.kind).toBe('passed');
    expect(driver.startPhaseSession).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'work',
        target: expect.objectContaining({ workspaceId: 'workspace-1' }),
        taskEnvironment: executionTarget.taskEnv,
        conversationId: expect.any(String),
      })
    );
    expect(commitSessionAttempt.mock.calls.map(([input]) => input.next.status)).toEqual([
      'starting',
      'running',
    ]);
    expect(commitWorkPhaseProgress).toHaveBeenCalledWith(
      expect.objectContaining({ checkpointCommit: checkpoint })
    );
    expect(exec).toHaveBeenCalledWith('git', ['add', '-A'], expect.any(Object));
  });

  it('interrupts and cancels a v2 session that resolves after a pause request', async () => {
    loop = makeV2Loop();
    const memory = makeMemoryDeps(loop, new Map([['unit-tests', passingVerifier('unit-tests')]]));
    const commitSessionAttempt = vi.fn(async (input) => {
      const attempts = [...input.expected.sessionAttempts];
      if (input.previous) {
        attempts[attempts.findIndex((attempt) => attempt.attemptId === input.previous.attemptId)] =
          input.next;
      } else {
        attempts.push(input.next);
      }
      return ok({ ...input.expected, sessionAttempts: attempts });
    });
    const pendingSession = deferred<Awaited<ReturnType<LoopSessionDriver['startPhaseSession']>>>();
    driver.startPhaseSession = vi.fn(() => pendingSession.promise);
    let reason: 'pause' | 'cancel' | null = null;
    const controller = new AbortController();
    const control: LoopRunControl = {
      signal: controller.signal,
      stopReason: () => reason,
      setActiveConversation: vi.fn(async (conversationId, activeDriver) => {
        if (conversationId && activeDriver && reason) {
          await activeDriver.cancelPrompt(conversationId);
        }
      }),
    };
    const run = new PhaseRunner({
      ...memory.deps,
      commitSessionAttempt: commitSessionAttempt as never,
    }).runPhase({
      loop,
      phase: loop.phases[0]!,
      executionTarget: makeExecutionTarget(),
      driver,
      control,
    });
    await vi.waitFor(() => expect(driver.startPhaseSession).toHaveBeenCalledOnce());
    reason = 'pause';
    controller.abort();
    pendingSession.resolve(ok({ conversationId: 'late-session', title: 'late' }));

    const result = await run;

    expect(result.success && result.data.kind).toBe('paused');
    expect(driver.cancelPrompt).toHaveBeenCalledWith(expect.any(String));
    expect(commitSessionAttempt.mock.calls.map(([input]) => input.next.status)).toEqual([
      'starting',
      'interrupted',
    ]);
  });

  it('fails closed when interruption persistence does not commit', async () => {
    loop = makeV2Loop();
    const memory = makeMemoryDeps(loop, new Map([['unit-tests', passingVerifier('unit-tests')]]));
    const commitSessionAttempt = vi.fn(async (input) => {
      if (input.next.status === 'interrupted') {
        return err({ kind: 'db-error' as const, message: 'interruption write failed' });
      }
      return ok({
        ...input.expected,
        sessionAttempts: [...input.expected.sessionAttempts, input.next],
      });
    });
    const pendingSession = deferred<Awaited<ReturnType<LoopSessionDriver['startPhaseSession']>>>();
    driver.startPhaseSession = vi.fn(() => pendingSession.promise);
    let reason: 'pause' | 'cancel' | null = null;
    const controller = new AbortController();
    const run = new PhaseRunner({
      ...memory.deps,
      commitSessionAttempt: commitSessionAttempt as never,
    }).runPhase({
      loop,
      phase: loop.phases[0]!,
      executionTarget: makeExecutionTarget(),
      driver,
      control: {
        signal: controller.signal,
        stopReason: () => reason,
        setActiveConversation: vi.fn(),
      },
    });
    await vi.waitFor(() => expect(driver.startPhaseSession).toHaveBeenCalledOnce());
    reason = 'pause';
    controller.abort();
    pendingSession.resolve(ok({ conversationId: 'late-session', title: 'late' }));

    const result = await run;

    expect(result).toEqual({
      success: false,
      error: {
        kind: 'operation-error',
        message: 'interruption write failed',
        cause: { kind: 'db-error', message: 'interruption write failed' },
      },
    });
  });

  it('persists verifier cancellation as interruption instead of failing the v2 phase', async () => {
    loop = makeV2Loop();
    let reason: 'pause' | 'cancel' | null = null;
    const controller = new AbortController();
    const verifier = passingVerifier('unit-tests');
    verifier.run = vi.fn(async () => {
      reason = 'pause';
      controller.abort();
      return err({
        kind: 'aborted',
        verifierId: 'unit-tests',
        message: 'validation cancelled',
        cwd: '/tmp/workspace',
      } satisfies VerifierError);
    });
    const memory = makeMemoryDeps(loop, new Map([['unit-tests', verifier]]));
    const commitSessionAttempt = vi.fn(async (input) => {
      const attempts = [...input.expected.sessionAttempts];
      if (input.previous) {
        attempts[attempts.findIndex((attempt) => attempt.attemptId === input.previous.attemptId)] =
          input.next;
      } else {
        attempts.push(input.next);
      }
      return ok({ ...input.expected, sessionAttempts: attempts });
    });
    driver.sendPrompt = vi.fn(async () => ok({ finalText: `Done\n${PHASE_DONE_SENTINEL}` }));

    const result = await new PhaseRunner({
      ...memory.deps,
      commitSessionAttempt: commitSessionAttempt as never,
    }).runPhase({
      loop,
      phase: loop.phases[0]!,
      executionTarget: makeExecutionTarget(),
      driver,
      control: {
        signal: controller.signal,
        stopReason: () => reason,
        setActiveConversation: vi.fn(),
      },
    });

    expect(result.success && result.data.kind).toBe('paused');
    expect(commitSessionAttempt.mock.calls.map(([input]) => input.next.status)).toEqual([
      'starting',
      'running',
      'interrupted',
    ]);
    expect(memory.loopTransitions).not.toContain('failed');
  });

  it('dispatches one terminal Review phase and atomically retains its checkpoint', async () => {
    const workLoop = makeV2Loop();
    const checkpoint = '2'.repeat(40);
    const reviewPhase: LoopPhase = {
      ...workLoop.phases[0]!,
      id: 'phase-review',
      idx: 1,
      name: 'Review',
      kind: 'review',
      status: 'pending',
      conversationId: null,
      state: {
        version: '2',
        checkpointCommit: null,
        handoff: null,
        retryHandoffs: [],
        result: null,
      },
    };
    loop = {
      ...workLoop,
      config: { ...workLoop.config!, terminalGates: { review: true, e2e: false } } as never,
      phases: [
        {
          ...workLoop.phases[0]!,
          status: 'passed',
          state: {
            version: '2',
            checkpointCommit: workLoop.state!.checkpointCommit,
            handoff: null,
            retryHandoffs: [],
            result: {
              status: 'passed',
              summary: 'Work passed.',
              completedAt: '2026-07-12T00:00:00.000Z',
            },
          },
        },
        reviewPhase,
      ],
    };
    const memory = makeMemoryDeps(loop, new Map());
    const stageResult = {
      status: 'passed' as const,
      summary: 'Review passed.',
      completedAt: '2026-07-12T01:00:00.000Z',
    };
    const runTerminalReviewPhase = vi.fn(async () =>
      ok({
        purpose: 'review' as const,
        conversationId: 'review-conversation',
        target: {
          workspaceId: 'workspace-1',
          path: '/tmp/workspace',
          machine: { kind: 'local' as const },
        },
        previousCheckpointCommit: workLoop.state!.checkpointCommit!,
        checkpointCommit: checkpoint,
        correctionApplied: true,
        requiredGateSummary: 'Review and required checks passed.',
        stageResult,
      })
    );
    const commitTerminalPhaseSuccess = vi.fn(async (input) =>
      ok({
        loop: {
          ...loop,
          state: { ...input.expectedLoopState, checkpointCommit: checkpoint },
        },
        phase: { ...reviewPhase, status: 'passed' as const },
      })
    );

    const result = await new PhaseRunner({
      ...memory.deps,
      runTerminalReviewPhase: runTerminalReviewPhase as never,
      commitTerminalPhaseSuccess: commitTerminalPhaseSuccess as never,
    }).runPhase({
      loop,
      phase: reviewPhase,
      executionTarget: makeExecutionTarget(),
      driver,
      control: makeControl(),
    });

    expect(result.success && result.data.kind).toBe('passed');
    expect(runTerminalReviewPhase).toHaveBeenCalledOnce();
    expect(commitTerminalPhaseSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'review-conversation',
        checkpointCommit: checkpoint,
        result: stageResult,
        sessionAttempts: [expect.objectContaining({ purpose: 'review', status: 'completed' })],
      })
    );
    expect(driver.startPhaseSession).not.toHaveBeenCalled();
  });

  it('retains a validated Review correction when the Review later fails', async () => {
    const workLoop = makeV2Loop();
    const correction = '2'.repeat(40);
    const reviewPhase: LoopPhase = {
      ...workLoop.phases[0]!,
      id: 'phase-review',
      idx: 1,
      name: 'Review',
      kind: 'review',
      status: 'pending',
      conversationId: null,
      state: {
        version: '2',
        checkpointCommit: null,
        handoff: null,
        retryHandoffs: [],
        result: null,
      },
    };
    loop = {
      ...workLoop,
      config: { ...workLoop.config!, terminalGates: { review: true, e2e: false } } as never,
      phases: [
        {
          ...workLoop.phases[0]!,
          status: 'passed',
          state: {
            version: '2',
            checkpointCommit: workLoop.state!.checkpointCommit,
            handoff: null,
            retryHandoffs: [],
            result: {
              status: 'passed',
              summary: 'Work passed.',
              completedAt: '2026-07-12T00:00:00.000Z',
            },
          },
        },
        reviewPhase,
      ],
    };
    const memory = makeMemoryDeps(loop, new Map());
    const stageResult = {
      status: 'failed' as const,
      summary: 'Review infrastructure failed after correction.',
      completedAt: '2026-07-12T01:00:00.000Z',
    };
    const runTerminalReviewPhase = vi.fn(async () =>
      err({
        message: 'Native browser CDP was unavailable',
        checkpointCommit: correction,
        observedHead: correction,
        recoveryRequired: false,
        conversationId: 'review-conversation',
        stageResult,
      })
    );
    const commitTerminalPhaseFailure = vi.fn(async (input) =>
      ok({
        loop: {
          ...loop,
          status: 'failed' as const,
          state: { ...input.expectedLoopState, checkpointCommit: correction },
        },
        phase: { ...reviewPhase, status: 'failed' as const },
      })
    );

    const result = await new PhaseRunner({
      ...memory.deps,
      runTerminalReviewPhase: runTerminalReviewPhase as never,
      commitTerminalPhaseFailure: commitTerminalPhaseFailure as never,
    }).runPhase({
      loop,
      phase: reviewPhase,
      executionTarget: makeExecutionTarget(),
      driver,
      control: makeControl(),
    });

    expect(result.success && result.data.kind).toBe('failed');
    expect(commitTerminalPhaseFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'review-conversation',
        checkpointCommit: correction,
        result: stageResult,
        sessionAttempts: [
          expect.objectContaining({
            purpose: 'review',
            status: 'failed',
            checkpointAfter: correction,
          }),
        ],
      })
    );
    expect(memory.loopTransitions).not.toContain('failed');
  });

  it('dispatches the durable clean-room E2E gate exactly once', async () => {
    const workLoop = makeV2Loop();
    const e2ePhase: LoopPhase = {
      ...workLoop.phases[0]!,
      id: 'phase-e2e',
      idx: 1,
      name: 'E2E',
      kind: 'e2e',
      status: 'pending',
      criteria: {
        version: '1',
        criteria: [
          { description: 'The native preview works', verifier: 'agent-browser', status: 'pending' },
        ],
      },
      state: {
        version: '2',
        checkpointCommit: null,
        handoff: null,
        retryHandoffs: [],
        result: null,
      },
    };
    loop = {
      ...workLoop,
      currentPhaseIndex: 1,
      config: {
        ...workLoop.config!,
        terminalGates: { review: false, e2e: true },
        browserPreview: { enabled: true },
      } as never,
      phases: [{ ...workLoop.phases[0]!, status: 'passed' }, e2ePhase],
    };
    const memory = makeMemoryDeps(loop, new Map());
    const stageResult = {
      status: 'passed' as const,
      summary: 'Clean-room E2E passed.',
      completedAt: '2026-07-12T02:00:00.000Z',
    };
    const runCleanRoomE2EPhase = vi.fn(async () => {
      await memory.deps.updatePhase(e2ePhase.id, {
        status: 'passed',
        state: {
          ...e2ePhase.state!,
          checkpointCommit: workLoop.state!.checkpointCommit,
          result: stageResult,
        },
      });
      return ok({ stageResult });
    });

    const result = await new PhaseRunner({
      ...memory.deps,
      runCleanRoomE2EPhase,
    }).runPhase({
      loop,
      phase: e2ePhase,
      executionTarget: makeExecutionTarget(),
      driver,
      control: makeControl(),
    });

    expect(result.success && result.data.kind).toBe('passed');
    expect(runCleanRoomE2EPhase).toHaveBeenCalledOnce();
    expect(runCleanRoomE2EPhase).toHaveBeenCalledWith(
      expect.objectContaining({
        loop,
        phase: expect.objectContaining({ status: 'reviewing', attempts: 1 }),
        driver,
      })
    );
    expect(driver.startVerificationSession).not.toHaveBeenCalled();
  });

  it('persists an E2E startup failure on both the phase and Loop', async () => {
    const workLoop = makeV2Loop();
    const e2ePhase: LoopPhase = {
      ...workLoop.phases[0]!,
      id: 'phase-e2e-startup-failure',
      idx: 1,
      name: 'E2E',
      kind: 'e2e',
      status: 'pending',
      criteria: {
        version: '1',
        criteria: [
          { description: 'The native preview works', verifier: 'agent-browser', status: 'pending' },
        ],
      },
      state: {
        version: '2',
        checkpointCommit: null,
        handoff: null,
        retryHandoffs: [],
        result: null,
      },
    };
    loop = {
      ...workLoop,
      currentPhaseIndex: 1,
      config: {
        ...workLoop.config!,
        terminalGates: { review: false, e2e: true },
        browserPreview: { enabled: true },
      } as never,
      phases: [{ ...workLoop.phases[0]!, status: 'passed' }, e2ePhase],
    };
    const memory = makeMemoryDeps(loop, new Map());

    const result = await new PhaseRunner({
      ...memory.deps,
      runCleanRoomE2EPhase: vi.fn(async () => err({ message: 'Invalid feature target' })),
    }).runPhase({
      loop,
      phase: e2ePhase,
      executionTarget: makeExecutionTarget(),
      driver,
      control: makeControl(),
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        kind: 'failed',
        loop: { status: 'failed' },
        phase: { status: 'failed', lastError: 'Invalid feature target' },
      },
    });
    expect(memory.phaseTransitions).toEqual(['reviewing', 'failed']);
    expect(memory.loopTransitions).toEqual(['failed']);
  });
});
