import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { claimOwnUpstream } from './own-upstream';

const run = promisify(execFile);

it('points a branch cut from another remote branch at its own name, else drops the upstream', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'emdash-own-upstream-'));
  const remote = path.join(root, 'remote.git');
  const repo = path.join(root, 'repo');
  const git = (...args: string[]) => run('git', args, { cwd: repo });
  const upstream = (branch: string) =>
    git('rev-parse', '--abbrev-ref', `${branch}@{upstream}`).then(
      (result) => result.stdout.trim(),
      () => null
    );
  const exec = { exec: (args: string[]) => git(...args) };
  try {
    await run('git', ['init', '--bare', remote]);
    await run('git', ['init', '-b', 'dev', repo]);
    await git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'i');
    await git('remote', 'add', 'origin', remote);
    await git(
      'push',
      'origin',
      'dev',
      'dev:refs/heads/feat/a',
      'dev:refs/heads/pr-head',
      'dev:refs/heads/master'
    );
    await git('fetch', 'origin');
    for (const branch of ['feat/a', 'feat/b', 'task'])
      await git('branch', '--track', branch, 'origin/dev');
    await git('branch', '--set-upstream-to=origin/pr-head', 'task');
    await git('config', 'branch.task.emdash-pr-url', 'https://example.com/pr/1');
    // Deliberate tracking (fork workflow, local base) is not git's creation default.
    await git('branch', 'main', 'dev');
    await git('branch', '--set-upstream-to=origin/master', 'main');
    await git('branch', '--track', 'local', 'dev');

    await claimOwnUpstream(exec, 'feat/a');
    await claimOwnUpstream(exec, 'feat/b');
    await claimOwnUpstream(exec, 'task');
    await claimOwnUpstream(exec, 'dev');
    await claimOwnUpstream(exec, 'main');
    await claimOwnUpstream(exec, 'local');

    expect(await upstream('feat/a')).toBe('origin/feat/a');
    expect(await upstream('feat/b')).toBeNull();
    expect(await upstream('task')).toBe('origin/pr-head');
    expect(await upstream('main')).toBe('origin/master');
    expect(await upstream('local')).toBe('dev');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
