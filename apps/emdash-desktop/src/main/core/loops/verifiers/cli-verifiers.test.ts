import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { Loop, LoopPhase } from '@shared/core/loops/loops';
import type { LoopExecutionTarget } from '../runtime/loop-execution-target';
import { convexVerifier } from './convex';
import { parseCommandLine } from './exec';
import { ghVerifier } from './gh';
import type { VerifierRunContext } from './types';
import { unitTestsVerifier } from './unit-tests';
import { vercelVerifier } from './vercel';

function makeTarget(exec: IExecutionContext['exec']): LoopExecutionTarget {
  const executionContext: IExecutionContext = {
    root: '/workspace',
    supportsLocalSpawn: false,
    exec,
    execStreaming: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    workspaceId: 'workspace-1',
    path: '/workspace',
    machine: { kind: 'ssh', connectionId: 'connection-1' },
    executionContext,
    taskEnv: {
      EMDASH_TASK_ID: 'task-1',
      EMDASH_TASK_PATH: '/workspace',
    },
    dispose: () => executionContext.dispose(),
  };
}

const loop = {
  id: 'loop-1',
  projectId: 'project-1',
  taskId: 'task-1',
  name: 'Loop',
  slug: 'loop',
  status: 'running',
  currentPhaseIndex: 0,
  config: null,
  createdAt: '',
  updatedAt: '',
} as Loop;

const phase = {
  id: 'phase-1',
  loopId: 'loop-1',
  idx: 0,
  name: 'Phase',
  goal: 'Goal',
  status: 'verifying',
  attempts: 1,
  conversationId: 'conversation-1',
  criteria: null,
  lastError: null,
  createdAt: '',
  updatedAt: '',
} as LoopPhase;

function runContext(
  target: LoopExecutionTarget,
  patch: Partial<VerifierRunContext> = {}
): VerifierRunContext {
  return {
    loop,
    phase,
    cwd: target.path,
    executionTarget: target,
    validationCommands: [],
    criteria: [],
    ...patch,
  };
}

describe('CLI verifier command parsing', () => {
  it('returns only explicit command assignments instead of copying the Electron environment', () => {
    const original = process.env.EMDASH_LANE_R_SECRET;
    process.env.EMDASH_LANE_R_SECRET = 'must-not-be-forwarded';
    try {
      const parsed = parseCommandLine('NODE_ENV=test pnpm run test -- --runInBand');
      expect(parsed.file).toBe('pnpm');
      expect(parsed.args).toEqual(['run', 'test', '--', '--runInBand']);
      expect(parsed.env.NODE_ENV).toBe('test');
      expect(Object.keys(parsed.env)).toEqual(['NODE_ENV']);
    } finally {
      if (original === undefined) delete process.env.EMDASH_LANE_R_SECRET;
      else process.env.EMDASH_LANE_R_SECRET = original;
    }
  });
});

describe('CLI verifier target delegation', () => {
  it('runs validation commands on the target without exposing environment values in evidence', async () => {
    const exec = vi.fn(async () => ({ stdout: 'passed', stderr: '' }));
    const target = makeTarget(exec);

    const result = await unitTestsVerifier.run(
      runContext(target, {
        validationCommands: [
          'EMDASH_TASK_PATH=/spoofed PRIVATE_TOKEN=do-not-record pnpm run test -- --runInBand',
        ],
      })
    );

    expect(result.success).toBe(true);
    expect(exec).toHaveBeenCalledWith(
      'pnpm',
      ['run', 'test', '--', '--runInBand'],
      expect.objectContaining({
        env: {
          EMDASH_TASK_ID: 'task-1',
          EMDASH_TASK_PATH: '/workspace',
          PRIVATE_TOKEN: 'do-not-record',
        },
      })
    );
    if (result.success) {
      expect(result.data.command).toBe('pnpm run test -- --runInBand');
      expect(result.data.command).not.toContain('do-not-record');
      expect(result.data.command).not.toContain('/spoofed');
    }
  });

  it.each([
    [ghVerifier, 'gh', ['--version']],
    [vercelVerifier, 'vercel', ['--version']],
    [convexVerifier, 'npx', ['convex', '--version']],
  ] as const)('checks $id availability on the supplied target', async (verifier, file, args) => {
    const exec = vi.fn(async () => ({ stdout: '1.0.0', stderr: '' }));
    const target = makeTarget(exec);

    const result = await verifier.checkAvailability(target.path, target);

    expect(result.success).toBe(true);
    expect(exec).toHaveBeenCalledWith(file, args, expect.objectContaining({ timeout: 15_000 }));
  });

  it('parses complete bounded GitHub JSON rather than a truncated evidence tail', async () => {
    const checks = [
      { name: 'required', state: 'failure', conclusion: 'failure', link: 'https://example.test' },
      ...Array.from({ length: 300 }, (_, index) => ({
        name: `padding-${index}`,
        state: 'success',
        conclusion: 'success',
      })),
    ];
    const target = makeTarget(vi.fn(async () => ({ stdout: JSON.stringify(checks), stderr: '' })));

    const result = await ghVerifier.run(runContext(target));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('required');
  });

  it('parses complete bounded Vercel JSON rather than a truncated evidence tail', async () => {
    const deployments = [
      { name: 'latest', state: 'ERROR' },
      ...Array.from({ length: 500 }, (_, index) => ({ name: `padding-${index}`, state: 'READY' })),
    ];
    const target = makeTarget(
      vi.fn(async () => ({ stdout: JSON.stringify({ deployments }), stderr: '' }))
    );

    const result = await vercelVerifier.run(runContext(target));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('ERROR');
  });

  it('does not fall back to another GitHub command after cancellation', async () => {
    const exec = vi.fn(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });
    const target = makeTarget(exec);

    const result = await ghVerifier.run(runContext(target));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.kind).toBe('aborted');
    expect(exec).toHaveBeenCalledOnce();
  });
});
