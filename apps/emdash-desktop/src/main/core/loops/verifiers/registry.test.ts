import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listVerifiers, requireVerifier } from './registry';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

describe('loop verifier registry', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(null, 'ok', '');
    });
  });

  it('registers all built-in verifiers', () => {
    expect(listVerifiers().map((verifier) => verifier.id)).toEqual([
      'unit-tests',
      'gh',
      'vercel',
      'convex',
      'agent-browser',
    ]);
  });

  it('executes validation commands with execFile argv and no shell option', async () => {
    const verifier = requireVerifier('unit-tests');

    const result = await verifier.run({
      loop: {
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
      },
      phase: {
        id: 'phase-1',
        loopId: 'loop-1',
        idx: 0,
        name: 'Phase',
        goal: 'Goal',
        status: 'verifying',
        attempts: 1,
        conversationId: 'conv-1',
        criteria: null,
        lastError: null,
        createdAt: '',
        updatedAt: '',
      },
      cwd: '/tmp/workspace',
      validationCommands: ['NODE_ENV=test pnpm run test -- --runInBand'],
      criteria: [],
    });

    expect(result.success).toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(
      'pnpm',
      ['run', 'test', '--', '--runInBand'],
      expect.objectContaining({
        cwd: '/tmp/workspace',
      }),
      expect.any(Function)
    );
    expect(execFileMock.mock.calls[0]?.[2]).not.toHaveProperty('shell');
  });

  it('reports command failures with stdout and stderr tails', async () => {
    execFileMock.mockImplementationOnce((_file, _args, _options, callback) => {
      callback(Object.assign(new Error('failed'), { code: 1 }), 'stdout', 'stderr');
    });

    const result = await requireVerifier('gh').checkAvailability('/tmp/workspace');

    expect(result.success).toBe(false);
    expect(!result.success && result.error).toMatchObject({
      kind: 'unavailable',
      verifierId: 'gh',
      stdoutTail: 'stdout',
      stderrTail: 'stderr',
    });
  });
});
