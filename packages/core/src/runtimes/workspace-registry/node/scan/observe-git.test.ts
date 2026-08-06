import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUntrackedLinesCache, observeWorkspaceGit } from './observe-git';

const run = promisify(execFile);

// Integration tests against a real temp repo: the untracked line-count cache
// must hit on unchanged files (stat-keyed), re-read changed files, respect the
// per-scan byte budget, and evict entries for files that stop being untracked.

let repo: string;

async function git(...args: string[]): Promise<void> {
  await run('git', args, { cwd: repo });
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'emdash-observe-git-'));
  await git('init');
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Test');
  await git('config', 'commit.gpgsign', 'false');
  await writeFile(join(repo, 'tracked.txt'), 'tracked\n');
  await git('add', '.');
  await git('commit', '-m', 'init');
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('observeWorkspaceGit untracked line counting', () => {
  it('counts untracked lines and fills the stat-keyed cache', async () => {
    await writeFile(join(repo, 'one.txt'), 'a\nb\nc\n');
    await writeFile(join(repo, 'two.txt'), 'x\n');
    const cache = createUntrackedLinesCache();

    const observed = await observeWorkspaceGit(repo, undefined, { untrackedCache: cache });

    expect(observed?.diffStats).toEqual({ added: 4, deleted: 0 });
    expect(cache.size).toBe(2);
    expect(cache.get('one.txt')?.lines).toBe(3);
  });

  it('serves unchanged files from the cache without re-reading them', async () => {
    await writeFile(join(repo, 'one.txt'), 'a\nb\nc\n');
    const cache = createUntrackedLinesCache();
    await observeWorkspaceGit(repo, undefined, { untrackedCache: cache });

    // Poison the cached count: if the rescan re-read the file this sentinel
    // would be overwritten and the total would revert to 3.
    const entry = cache.get('one.txt');
    expect(entry).toBeDefined();
    cache.set('one.txt', { ...entry!, lines: 999 });

    const observed = await observeWorkspaceGit(repo, undefined, { untrackedCache: cache });
    expect(observed?.diffStats).toEqual({ added: 999, deleted: 0 });
  });

  it('re-reads files whose stat changed', async () => {
    await writeFile(join(repo, 'one.txt'), 'a\nb\nc\n');
    const cache = createUntrackedLinesCache();
    await observeWorkspaceGit(repo, undefined, { untrackedCache: cache });

    const entry = cache.get('one.txt');
    cache.set('one.txt', { ...entry!, lines: 999 });
    await writeFile(join(repo, 'one.txt'), 'a\nb\nc\nd\ne\n');

    const observed = await observeWorkspaceGit(repo, undefined, { untrackedCache: cache });
    expect(observed?.diffStats).toEqual({ added: 5, deleted: 0 });
    expect(cache.get('one.txt')?.lines).toBe(5);
  });

  it('degrades the untracked component to null when the byte budget is exceeded', async () => {
    await writeFile(join(repo, 'big.txt'), 'line\n'.repeat(1_000));
    const observed = await observeWorkspaceGit(repo, undefined, {
      untrackedCache: createUntrackedLinesCache(),
      untrackedByteBudget: 100,
    });

    // Tracked diff is empty and the untracked count degraded: no +N inflation.
    expect(observed?.diffStats).toEqual({ added: 0, deleted: 0 });
  });

  it('cached files do not consume the byte budget on later scans', async () => {
    await writeFile(join(repo, 'one.txt'), 'line\n'.repeat(50));
    const cache = createUntrackedLinesCache();
    await observeWorkspaceGit(repo, undefined, { untrackedCache: cache });

    // Budget smaller than the file: only viable because the count is cached.
    const observed = await observeWorkspaceGit(repo, undefined, {
      untrackedCache: cache,
      untrackedByteBudget: 10,
    });
    expect(observed?.diffStats).toEqual({ added: 50, deleted: 0 });
  });

  it('evicts cache entries for files that are no longer untracked', async () => {
    await writeFile(join(repo, 'one.txt'), 'a\n');
    await writeFile(join(repo, 'two.txt'), 'b\n');
    const cache = createUntrackedLinesCache();
    await observeWorkspaceGit(repo, undefined, { untrackedCache: cache });
    expect(cache.size).toBe(2);

    await git('add', 'one.txt');
    await observeWorkspaceGit(repo, undefined, { untrackedCache: cache });
    expect([...cache.keys()]).toEqual(['two.txt']);
  });
});
