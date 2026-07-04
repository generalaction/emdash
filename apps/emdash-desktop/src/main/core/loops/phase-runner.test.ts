import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@main/lib/result';
import type { Loop, LoopPhase, LoopWithPhases } from '@shared/core/loops/loops';
import type { LoopSessionDriver } from './drivers/session-driver';
import { MAX_PHASE_ATTEMPTS, PhaseRunner, type LoopRunControl } from './phase-runner';
import { PHASE_DONE_SENTINEL } from './prompt-builder';
import type { BuiltInVerifierId, LoopVerifier, VerifierError } from './verifiers/types';

vi.mock('./operations/loop-operations', () => ({
  getLoop: vi.fn(),
  updateLoop: vi.fn(),
  updatePhase: vi.fn(),
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
      sendPrompt: vi.fn(async () => ok({ finalText: `Done\n${PHASE_DONE_SENTINEL}` })),
      cancelPrompt: vi.fn(async () => ok(undefined)),
    };
  });

  it('passes a phase after done sentinel and green verifier gate', async () => {
    const verifiers = new Map<BuiltInVerifierId, LoopVerifier>([
      ['unit-tests', passingVerifier('unit-tests')],
      ['gh', passingVerifier('gh')],
    ]);
    const memory = makeMemoryDeps(loop, verifiers);

    const result = await new PhaseRunner(memory.deps).runPhase({
      loop,
      phase: loop.phases[0]!,
      cwd: '/tmp/workspace',
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
      cwd: '/tmp/workspace',
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
      cwd: '/tmp/workspace',
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
      cwd: '/tmp/workspace',
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
      cwd: '/tmp/workspace',
      driver,
      control: makeControl(),
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.kind).toBe('failed');
    expect(memory.current().phases[0]?.lastError).toBe('Loop prompt failed');
  });
});
