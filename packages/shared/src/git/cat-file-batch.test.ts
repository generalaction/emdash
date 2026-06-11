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
