import { describe, expect, it, vi } from 'vitest';
import { NodeExecutionContext } from './node-execution-context';

describe('NodeExecutionContext', () => {
  it('delegates shell env refresh when configured', async () => {
    const refreshShellEnv = vi.fn(async () => {});
    const context = new NodeExecutionContext({ refreshShellEnv });

    await context.refreshShellEnv?.();

    expect(refreshShellEnv).toHaveBeenCalledOnce();
  });

  it('returns the exit code from a streaming command', async () => {
    const context = new NodeExecutionContext();

    const result = await context.execStreaming(
      process.execPath,
      ['-e', "process.stdout.write('ok'); process.exit(7);"],
      () => true
    );

    expect(result).toEqual({ exitCode: 7 });
  });

  it('returns zero for a successful streaming command', async () => {
    const context = new NodeExecutionContext();

    const result = await context.execStreaming(
      process.execPath,
      ['-e', "process.stdout.write('ok');"],
      () => true
    );

    expect(result).toEqual({ exitCode: 0 });
  });
});
