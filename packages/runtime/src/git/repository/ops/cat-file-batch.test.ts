import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { BoundExec } from '@emdash/core/exec';
import { describe, expect, it } from 'vitest';
import { bindGitDir, createGitExec } from '../../exec/git-exec';
import { CatFileBatch } from './cat-file-batch';

const execFileAsync = promisify(execFile);

async function makeRepo(content = 'hello\n'): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), 'emdash-shared-catfile-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  await writeFile(path.join(repo, 'a.txt'), content, 'utf8');
  await execFileAsync('git', ['add', 'a.txt'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo });
  return repo;
}

function countSpawns(exec: BoundExec, onSpawn: () => void): BoundExec {
  return {
    file: exec.file,
    cwd: exec.cwd,
    env: exec.env,
    exec: (args, options) => exec.exec(args, options),
    execStreaming: (args, onStdout, options) => exec.execStreaming(args, onStdout, options),
    execBuffer: (args, options) => exec.execBuffer(args, options),
    spawn: (args, options) => {
      onSpawn();
      return exec.spawn(args, options);
    },
    withCwd: (cwd) => countSpawns(exec.withCwd(cwd), onSpawn),
  };
}

describe('CatFileBatch', () => {
  it('reuses one repository-scoped process for repeated reads', async () => {
    const target = await makeRepo('target\n');
    const runtimeCwd = await makeRepo('other\n');
    const gitDir = await realpath(path.join(target, '.git'));
    let spawnCount = 0;
    const exec = countSpawns(bindGitDir(createGitExec({ cwd: runtimeCwd }), gitDir), () => {
      spawnCount += 1;
    });
    const batch = new CatFileBatch({ exec });

    try {
      await expect(batch.readText('HEAD:a.txt')).resolves.toBe('target\n');
      await expect(batch.readText('HEAD:a.txt')).resolves.toBe('target\n');
      await expect(batch.readText('HEAD:missing.txt')).resolves.toBeNull();
      expect(spawnCount).toBe(1);
    } finally {
      batch.dispose();
      await rm(target, { recursive: true, force: true });
      await rm(runtimeCwd, { recursive: true, force: true });
    }
  });

  it('reads multi-megabyte blobs through chunked stdout', async () => {
    const content = `${'x'.repeat(100)}\n`.repeat(40_000);
    const repo = await makeRepo(content);
    const gitDir = await realpath(path.join(repo, '.git'));
    const batch = new CatFileBatch({
      exec: bindGitDir(createGitExec({ cwd: tmpdir() }), gitDir),
    });

    try {
      await expect(batch.readText('HEAD:a.txt')).resolves.toBe(content);
    } finally {
      batch.dispose();
      await rm(repo, { recursive: true, force: true });
    }
  });
});
