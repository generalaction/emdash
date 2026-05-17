import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

const spawnMock = vi.hoisted(() => vi.fn());
const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}));

const { LocalExecutionContext } = await import('./local-execution-context');

class FakeChildProcess extends EventEmitter {
  stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });

  kill = vi.fn();
}

describe('LocalExecutionContext', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    spawnMock.mockReset();
  });

  it('resolves logical git command for buffered local execution', async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(null, { stdout: '', stderr: '' });
    });
    const ctx = new LocalExecutionContext({ root: '/repo' });

    await ctx.exec('git', ['status']);

    expect(execFileMock).toHaveBeenCalledWith(
      GIT_EXECUTABLE,
      ['status'],
      expect.objectContaining({ cwd: '/repo' }),
      expect.any(Function)
    );
  });

  it('resolves logical git command for streaming local execution', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const ctx = new LocalExecutionContext({ root: '/repo' });

    const promise = ctx.execStreaming('git', ['status'], () => true);
    child.emit('close', 0);
    await promise;

    expect(spawnMock).toHaveBeenCalledWith(GIT_EXECUTABLE, ['status'], { cwd: '/repo' });
  });
});
