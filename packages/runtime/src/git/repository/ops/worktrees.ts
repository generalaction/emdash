import type { WorktreeHeadSummary, WorktreeSummary } from '@emdash/core/git';

const UNBORN_OID = /^0+$/;

export function parseWorktreeList(stdout: string): WorktreeSummary[] {
  const worktrees: WorktreeSummary[] = [];
  let current: Partial<{
    path: string;
    oid: string;
    branch: string;
    detached: boolean;
    locked: boolean;
    prunable: boolean;
  }> = {};

  const flush = () => {
    if (!current.path) return;
    worktrees.push({
      worktreePath: current.path,
      isMain: worktrees.length === 0,
      head: toWorktreeHead(current),
      ...(current.locked ? { locked: true } : {}),
      ...(current.prunable ? { prunable: true } : {}),
    });
    current = {};
  };

  for (const line of stdout.split('\n')) {
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) current.path = line.slice('worktree '.length);
    else if (line.startsWith('HEAD ')) current.oid = line.slice('HEAD '.length);
    else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line === 'detached') current.detached = true;
    else if (line === 'locked' || line.startsWith('locked ')) current.locked = true;
    else if (line === 'prunable' || line.startsWith('prunable ')) current.prunable = true;
  }
  flush();

  return worktrees;
}

export function toWorktreeHead(entry: {
  oid?: string;
  branch?: string;
  detached?: boolean;
}): WorktreeHeadSummary {
  const oid = entry.oid ?? '';
  if (entry.branch && (!oid || UNBORN_OID.test(oid))) {
    return { kind: 'unborn', name: entry.branch };
  }
  if (entry.branch) return { kind: 'branch', name: entry.branch };
  return { kind: 'detached' };
}
