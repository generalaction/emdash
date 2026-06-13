import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { CatFileBatch } from './cat-file-batch';
import { createGitExec } from './git-env';

const execFileAsync = promisify(execFile);

async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), 'emdash-shared-catfile-'));
  await execFileAsync('git', ['init'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  await writeFile(path.join(repo, 'a.txt'), 'hello\n', 'utf8');
  await execFileAsync('git', ['add', 'a.txt'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo });
  return repo;
}

describe('CatFileBatch', () => {
  it('reads multi-megabyte blobs through chunked stdout', async () => {
    const repo = await mkdtemp(path.join(tmpdir(), 'emdash-shared-catfile-large-'));
    await execFileAsync('git', ['init'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo });

    const line = 'x'.repeat(100) + '\n';
    const lineCount = 40_000;
    const content = line.repeat(lineCount);
    await writeFile(path.join(repo, 'large.txt'), content, 'utf8');
    await execFileAsync('git', ['add', 'large.txt'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'large blob'], { cwd: repo });

    const batch = new CatFileBatch({ exec: createGitExec({ cwd: repo }) });
    try {
      const result = await batch.readText('HEAD:large.txt');
      expect(result).toBe(content);
      expect(result?.length).toBe(content.length);
    } finally {
      batch.dispose();
    }
  });

  it('reads real git objects through one persistent batch process', async () => {
    const repo = await makeRepo();
    const batch = new CatFileBatch({ exec: createGitExec({ cwd: repo }) });
    try {
      await expect(batch.readText('HEAD:a.txt')).resolves.toBe('hello\n');
      await expect(batch.readText('HEAD:missing.txt')).resolves.toBeNull();
    } finally {
      batch.dispose();
    }
  });
});
