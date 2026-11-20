type GitExec = { exec(args: string[]): Promise<{ stdout: string }> };

/**
 * Re-points a branch whose tracking git set when it was cut from a base (`git checkout -b x
 * origin/dev`) at its own `<remote>/<branch>`, or drops it when that does not exist. Tracking set
 * any other way (`main` → `upstream/master`, PR task branches, fork PR refs) is left alone.
 */
export async function claimOwnUpstream(git: GitExec, branch: string): Promise<void> {
  const read = (...args: string[]) =>
    git.exec(args).then(
      (result) => result.stdout.trim(),
      () => ''
    );
  const config = (key: string) => read('config', '--get', `branch.${branch}.${key}`);
  const merge = await config('merge');
  if (!merge.startsWith('refs/heads/') || merge === `refs/heads/${branch}`) return;
  if (await config('emdash-pr-url')) return;
  const remote = await config('remote');
  const created = (await read('reflog', 'show', '--format=%gs', `refs/heads/${branch}`))
    .split('\n')
    .at(-1);
  if (created !== `branch: Created from ${remote}/${merge.slice('refs/heads/'.length)}`) return;
  if (await read('rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${branch}`))
    await git.exec(['branch', `--set-upstream-to=${remote}/${branch}`, '--', branch]);
  else await git.exec(['branch', '--unset-upstream', '--', branch]);
}
