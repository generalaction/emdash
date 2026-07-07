import type { BoundExec } from '../../exec';
import type { GitBranch, GitRefsModel, GitRemote, GitTag } from './models/refs';
import type { GitRemotesModel } from './models/remotes';
import type { GitStash, GitStashesModel } from './models/stashes';

const FIELD_SEPARATOR = '\u0000';

export async function computeRemotesModel(exec: BoundExec): Promise<GitRemotesModel> {
  const { stdout } = await exec.exec(['remote', '-v']);
  const seen = new Set<string>();
  const remotes: GitRemote[] = [];

  for (const line of stdout.trim().split('\n').filter(Boolean)) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line);
    if (!match || match[3] !== 'fetch') continue;
    const name = match[1]!;
    if (seen.has(name)) continue;
    seen.add(name);
    remotes.push({ name, url: match[2]! });
  }

  return { remotes };
}

export async function computeRefsModel(
  exec: BoundExec,
  remotes: GitRemote[]
): Promise<GitRefsModel> {
  const [branches, tags] = await Promise.all([computeBranches(exec, remotes), computeTags(exec)]);
  return { branches, tags };
}

async function computeBranches(exec: BoundExec, remotes: GitRemote[]): Promise<GitBranch[]> {
  const remoteByName = new Map(remotes.map((remote) => [remote.name, remote]));
  const { stdout } = await exec.exec([
    'branch',
    '-a',
    '--format=%(refname)|%(refname:short)|%(upstream:short)|%(upstream:track)|%(objectname)',
  ]);
  const branches: GitBranch[] = [];

  for (const line of stdout.trim().split('\n').filter(Boolean)) {
    const [fullRef, shortRef, upstreamRef, upstreamTrack, oid] = line.split('|');
    if (!fullRef || !shortRef || !oid) continue;
    if (fullRef.startsWith('refs/remotes/')) {
      const remoteBranch = fullRef.slice('refs/remotes/'.length);
      if (remoteBranch.endsWith('/HEAD')) continue;
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

  return branches;
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

export async function computeStashesModel(exec: BoundExec): Promise<GitStashesModel> {
  const { stdout } = await exec.exec(['stash', 'list', '--format=%gd%x00%H%x00%ct%x00%gs']);
  const stashes: GitStash[] = [];

  for (const line of stdout.split('\n').filter(Boolean)) {
    const [ref, oid, timestamp, message] = line.split(FIELD_SEPARATOR);
    if (!ref || !oid) continue;
    const index = /^stash@\{(\d+)\}$/.exec(ref)?.[1];
    if (index === undefined) continue;
    const stash: GitStash = {
      index: Number.parseInt(index, 10),
      ref,
      oid,
      message: message ?? '',
      createdAt: timestamp ? Number.parseInt(timestamp, 10) * 1000 : 0,
    };
    const branch = /^(?:WIP on|On) ([^:]+):/.exec(message ?? '')?.[1];
    if (branch && branch !== '(no branch)') stash.branch = branch;
    stashes.push(stash);
  }

  return { stashes };
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
