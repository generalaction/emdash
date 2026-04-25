import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CatFileBatch } from './cat-file-batch';

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'emdash-catfile-'));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "t@test.local"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "test"', { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'a.txt'), 'hello\n');
  execSync('git add a.txt && git commit -m init', { cwd: dir, stdio: 'pipe' });
  return dir;
}

describe('CatFileBatch', () => {
  it('reads blob contents via git cat-file --batch', async () => {
    const dir = makeTempRepo();
    const batch = new CatFileBatch(dir);
    try {
      const content = await batch.read('HEAD:a.txt');
      expect(content).toBe('hello\n');
    } finally {
      batch.dispose();
    }
  });

  it('resolves null for a missing path', async () => {
    const dir = makeTempRepo();
    const batch = new CatFileBatch(dir);
    try {
      expect(await batch.read('HEAD:does-not-exist.txt')).toBeNull();
    } finally {
      batch.dispose();
    }
  });

  it('rejects new reads after dispose', async () => {
    const dir = makeTempRepo();
    const batch = new CatFileBatch(dir);
    batch.dispose();
    await expect(batch.read('HEAD:a.txt')).rejects.toThrow();
  });
});
