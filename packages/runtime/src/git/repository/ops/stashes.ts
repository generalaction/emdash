import type { BoundExec } from '@emdash/core/exec';
import type { GitStash, GitStashesModel } from '@emdash/core/git';

const FIELD_SEPARATOR = '\u0000';

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
