import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildAllowlistedAgentEnv } from '#primitives/agent-env/api';
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

  it('resolves the current environment for every command spawn', async () => {
    let env = { EMDASH_ENV_REVISION: 'before-refresh' };
    const context = new NodeExecutionContext({ env: async () => env });

    const before = await context.exec(process.execPath, ['-p', 'process.env.EMDASH_ENV_REVISION']);
    env = { EMDASH_ENV_REVISION: 'after-refresh' };
    const after = await context.exec(process.execPath, ['-p', 'process.env.EMDASH_ENV_REVISION']);

    expect(before.stdout.trim()).toBe('before-refresh');
    expect(after.stdout.trim()).toBe('after-refresh');
  });

  it('replaces the context environment with a per-command environment', async () => {
    const currentPath = process.env.PATH ?? process.env.Path ?? '';
    const hostPath = [path.dirname(process.execPath), currentPath]
      .filter(Boolean)
      .join(path.delimiter);
    const safeEnv = buildAllowlistedAgentEnv(
      {
        Path: hostPath,
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        UNSAFE_ENV: 'must-not-leak',
      },
      { platform: 'windows' }
    );
    const context = new NodeExecutionContext({
      env: { ...safeEnv, UNSAFE_ENV: 'must-not-leak' },
    });
    const script = [
      "const { spawnSync } = require('node:child_process');",
      "const nested = spawnSync('node', ['--version'], { encoding: 'utf8' });",
      'process.stdout.write(JSON.stringify({',
      '  path: process.env.PATH,',
      '  unsafe: process.env.UNSAFE_ENV,',
      '  nestedStatus: nested.status,',
      '}));',
    ].join('\n');

    const { stdout } = await context.exec(process.execPath, ['-e', script], { env: safeEnv });

    expect(JSON.parse(stdout)).toEqual({ path: hostPath, nestedStatus: 0 });
  });
});
