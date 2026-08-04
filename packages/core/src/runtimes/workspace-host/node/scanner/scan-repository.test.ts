import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseAbsolute } from '@primitives/path/api';
import { describe, expect, it } from 'vitest';
import { scanRepository } from './scan-repository';

const execFileAsync = promisify(execFile);

describe('scanRepository', () => {
  it('lists repository worktrees and enriches full-tier git facts', async () => {
    const repo = await makeRepo();
    const linked = path.join(path.dirname(repo), 'linked-worktree');
    try {
      await git(repo, ['worktree', 'add', '-b', 'task/change', linked, 'HEAD']);
      await writeFile(path.join(linked, 'tracked.txt'), 'after\n', 'utf8');

      const result = await scanRepository({
        repoRoot: hostPath(repo),
        tier: 'full',
      });

      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error.message);
      expect(result.data.worktrees).toHaveLength(2);
      const worktree = result.data.worktrees.find((entry) => entry.branch === 'task/change');
      expect(worktree).toMatchObject({
        status: 'present',
        dirty: true,
        diffStats: { added: 1, deleted: 1 },
      });
      expect(worktree?.adminName).toBeTruthy();
    } finally {
      await rm(path.dirname(repo), { recursive: true, force: true });
    }
  });
});

async function makeRepo(): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), 'emdash-workspace-host-scan-'));
  const repo = path.join(parent, 'repo');
  await git(parent, ['init', '-b', 'main', repo]);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test User']);
  await writeFile(path.join(repo, 'tracked.txt'), 'before\n', 'utf8');
  await git(repo, ['add', 'tracked.txt']);
  await git(repo, ['commit', '-m', 'init']);
  return realpath(repo);
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

function hostPath(value: string) {
  const parsed = parseAbsolute(value);
  if (!parsed.success) throw new Error(`Expected absolute path: ${value}`);
  return parsed.data;
}
