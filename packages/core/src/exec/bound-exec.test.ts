import { chmod, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBoundExec, ExecError } from './index';

describe('BoundExec', () => {
  it('runs a configured executable from a fixed cwd', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'emdash-shared-exec-'));
    const result = await createBoundExec({ file: process.execPath, cwd }).exec([
      '-e',
      'console.log(process.cwd())',
    ]);

    await expect(realpath(result.stdout.trim())).resolves.toBe(await realpath(cwd));
    expect(result.stderr).toBe('');
  });

  it('streams stdout and lets the consumer stop early', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'emdash-shared-exec-stream-'));
    const chunks: string[] = [];

    await createBoundExec({ file: process.execPath, cwd }).execStreaming(
      ['-e', "console.log('one'); console.log('two');"],
      (chunk) => {
        chunks.push(chunk);
        return false;
      }
    );

    expect(chunks.join('')).toContain('one');
  });

  it('throws ExecError with serializable process details on non-zero exit', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'emdash-shared-exec-error-'));
    await expect(
      createBoundExec({ file: 'git', cwd }).exec(['rev-parse', '--not-a-real-flag'])
    ).rejects.toMatchObject({
      exitCode: 128,
      file: 'git',
      args: ['rev-parse', '--not-a-real-flag'],
    });
  });

  it('uses the configured executable path', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'emdash-shared-exec-bin-'));
    const executable = path.join(dir, 'tool.sh');
    const logPath = path.join(dir, 'calls.log');
    await writeFile(
      executable,
      ['#!/bin/sh', `printf '%s\\n' "$1" >> ${JSON.stringify(logPath)}`, 'exit 7', ''].join('\n'),
      'utf8'
    );
    await chmod(executable, 0o755);

    await expect(
      createBoundExec({ file: executable, cwd: dir }).exec(['hello'])
    ).rejects.toBeInstanceOf(ExecError);
    await expect(readFile(logPath, 'utf8')).resolves.toBe('hello\n');
  });

  it('rejects timed-out processes with an ExecError', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'emdash-shared-exec-timeout-'));

    await expect(
      createBoundExec({ file: process.execPath, cwd }).exec(
        ['-e', 'setTimeout(() => {}, 10_000);'],
        { timeoutMs: 50 }
      )
    ).rejects.toMatchObject({
      file: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 10_000);'],
      stderr: 'Timed out after 50ms',
    });
  });

  it('escalates timed-out processes that ignore SIGTERM', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'emdash-shared-exec-timeout-kill-'));
    const pidPath = path.join(cwd, 'child.pid');

    await expect(
      createBoundExec({ file: process.execPath, cwd }).exec(
        [
          '-e',
          [
            "const fs = require('node:fs');",
            `fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
            "process.on('SIGTERM', () => {});",
            'setInterval(() => {}, 10_000);',
          ].join(' '),
        ],
        { timeoutMs: 250 }
      )
    ).rejects.toBeInstanceOf(ExecError);

    const pid = Number.parseInt(await readFile(pidPath, 'utf8'), 10);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(isProcessAlive(pid)).toBe(false);
  });
});

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
