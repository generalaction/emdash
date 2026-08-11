import type { GitBranch, GitRefsState, GitRemote, GitRemoteHead, GitTag } from '#runtimes/git/api';
import type { BoundExec } from '#services/exec/api';

const FIELD_SEPARATOR = '\u0000';

export async function computeRefsState(
  exec: BoundExec,
  remotes: GitRemote[]
): Promise<GitRefsState> {
  const [{ branches, remoteHeads }, tags] = await Promise.all([
    computeBranches(exec, remotes),
    computeTags(exec),
  ]);
  return { branches, tags, remoteHeads };
}

async function computeBranches(
  exec: BoundExec,
  remotes: GitRemote[]
): Promise<{ branches: GitBranch[]; remoteHeads: GitRemoteHead[] }> {
  const remoteByName = new Map(remotes.map((remote) => [remote.name, remote]));
  const { stdout } = await exec.exec([
    'branch',
    '-a',
    '--format=%(refname)|%(refname:short)|%(upstream:short)|%(upstream:track)|%(objectname)|%(symref)',
  ]);
  const branches: GitBranch[] = [];
  const remoteHeads: GitRemoteHead[] = [];

  for (const line of stdout.trim().split('\n').filter(Boolean)) {
    const [fullRef, shortRef, upstreamRef, upstreamTrack, oid, symref] = line.split('|');
    if (!fullRef || !shortRef || !oid) continue;
    if (fullRef.startsWith('refs/remotes/')) {
      const remoteBranch = fullRef.slice('refs/remotes/'.length);
      if (remoteBranch.endsWith('/HEAD')) {
        // The remote HEAD symbolic ref: `%(symref)` carries its target
        // (`refs/remotes/<remote>/<branch>`) — a free local read.
        const remoteName = remoteBranch.slice(0, -'/HEAD'.length);
        const targetPrefix = `refs/remotes/${remoteName}/`;
        if (symref?.startsWith(targetPrefix)) {
          remoteHeads.push({ remote: remoteName, branch: symref.slice(targetPrefix.length) });
        }
        continue;
      }
      const slash = remoteBranch.indexOf('/');
      if (slash === -1) continue;
      const remoteName = remoteBranch.slice(0, slash);
      const branch = remoteBranch.slice(slash + 1);
      branches.push({
        type: 'remote',
        branch,
        remote: remoteByName.get(remoteName) ?? { name: remoteName, url: '' },
        oid,
      });
      continue;
    }

    if (!fullRef.startsWith('refs/heads/')) continue;
    const branch: GitBranch = { type: 'local', branch: shortRef, oid };
    if (upstreamRef) {
      const slash = upstreamRef.indexOf('/');
      const remoteName = slash === -1 ? upstreamRef : upstreamRef.slice(0, slash);
      branch.remote = remoteByName.get(remoteName) ?? { name: remoteName, url: '' };
    }
    const divergence = parseDivergence(upstreamTrack ?? '');
    if (divergence) branch.divergence = divergence;
    branches.push(branch);
  }

  return { branches, remoteHeads };
}

async function computeTags(exec: BoundExec): Promise<GitTag[]> {
  const { stdout } = await exec.exec([
    'for-each-ref',
    'refs/tags',
    '--format=%(refname:short)%00%(objectname)%00%(*objectname)%00%(contents:subject)',
  ]);
  const tags: GitTag[] = [];

  for (const line of stdout.split('\n').filter(Boolean)) {
    const [name, oid, peeledOid, subject] = line.split(FIELD_SEPARATOR);
    if (!name || !oid) continue;
    const tag: GitTag = { name, oid: peeledOid || oid };
    if (subject) tag.message = subject;
    tags.push(tag);
  }

  return tags;
}

function parseDivergence(upstreamTrack: string): { ahead: number; behind: number } | undefined {
  if (!upstreamTrack) return undefined;
  const ahead = /ahead (\d+)/.exec(upstreamTrack)?.[1];
  const behind = /behind (\d+)/.exec(upstreamTrack)?.[1];
  if (!ahead && !behind) return undefined;
  return {
    ahead: ahead ? Number.parseInt(ahead, 10) : 0,
    behind: behind ? Number.parseInt(behind, 10) : 0,
  };
}
