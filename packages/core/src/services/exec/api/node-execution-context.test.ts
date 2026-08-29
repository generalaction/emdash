import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

  it('uses the Windows launch planner for buffered and streaming cmd shims', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'emdash-windows-exec-'));
    const cmdWrapper = path.join(dir, 'cmd-wrapper');
    const provider = path.join(dir, 'provider.cmd');
    await writeFile(cmdWrapper, '#!/bin/sh\nprintf \'%s\\n\' "$@"\n', 'utf8');
    await chmod(cmdWrapper, 0o755);
    const env = { ComSpec: cmdWrapper, PATH: dir, PATHEXT: '.CMD' };
    const context = new NodeExecutionContext({
      platform: 'win32',
      env,
      fileExists: (candidate) => candidate === provider,
    });

    const buffered = await context.exec(provider, ['hello world']);
    const streamed: string[] = [];
    const streaming = await context.execStreaming(provider, ['streamed'], (chunk) => {
      streamed.push(chunk);
      return true;
    });

    expect(buffered.stdout).toContain('/d\n/s\n/c\n');
    expect(buffered.stdout).toContain('provider.cmd');
    expect(buffered.stdout).toContain('hello world');
    expect(streaming).toEqual({ exitCode: 0 });
    expect(streamed.join('')).toContain('provider.cmd');
    expect(streamed.join('')).toContain('streamed');
  });

  it('kills streaming descendants when the consumer stops early', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'emdash-stream-stop-tree-'));
    const pidPath = path.join(dir, 'descendant.pid');
    const context = new NodeExecutionContext();
    const execution = context.execStreaming(
      process.execPath,
      ['-e', descendantSpawnerScript(pidPath)],
      () => false
    );
    const descendantPid = Number.parseInt(await waitForFile(pidPath), 10);

    await expect(execution).resolves.toMatchObject({ exitCode: null });
    expect(isProcessAlive(descendantPid)).toBe(false);
  });

  it('awaits forced descendant cleanup when the context is disposed', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'emdash-context-dispose-tree-'));
    const pidPath = path.join(dir, 'descendant.pid');
    const context = new NodeExecutionContext();
    const execution = context.execStreaming(
      process.execPath,
      ['-e', descendantSpawnerScript(pidPath, true)],
      () => true
    );
    const descendantPid = Number.parseInt(await waitForFile(pidPath), 10);

    context.dispose();
    context.dispose();

    await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
    expect(isProcessAlive(descendantPid)).toBe(false);
  });
});

function descendantSpawnerScript(pidPath: string, ignoreSigterm = false): string {
  const descendantProgram = [
    ...(ignoreSigterm ? ["process.on('SIGTERM', () => {});"] : []),
    'setInterval(() => {}, 10_000);',
  ].join(' ');
  return [
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    `const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantProgram)}], { stdio: 'ignore' });`,
    `fs.writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
    "process.stdout.write('ready');",
    ...(ignoreSigterm ? ["process.on('SIGTERM', () => {});"] : []),
    'setInterval(() => {}, 10_000);',
  ].join(' ');
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(filePath: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await readFile(filePath, 'utf8');
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}
