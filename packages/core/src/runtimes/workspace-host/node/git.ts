import type { HostAbsolutePath } from '@primitives/path/api';
import { createBoundExec, type BoundExec } from '@services/exec/api';
import type { WorkspaceHostWorktreeHead } from '../api';

const UNBORN_OID = /^0+$/;

export function createWorkspaceHostGitExec(cwd: string): BoundExec {
  return createBoundExec({
    file: 'git',
    cwd,
    env: {
      ...process.env,
      LC_ALL: 'C',
      LANG: 'C',
      LANGUAGE: 'C',
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
      ...(process.env.GIT_SSH_COMMAND ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }),
    },
  });
}

export interface WorkspaceHostWorktreeSummary {
  worktreePath: HostAbsolutePath;
  isMain: boolean;
  head: WorkspaceHostWorktreeHead;
  locked?: boolean;
  prunable?: boolean;
  prunableReason?: string;
}

export function parseWorkspaceHostWorktreeList(
  stdout: string,
  parsePath: (filePath: string) => HostAbsolutePath
): WorkspaceHostWorktreeSummary[] {
  const worktrees: WorkspaceHostWorktreeSummary[] = [];
  let current: Partial<{
    path: string;
    oid: string;
    branch: string;
    detached: boolean;
    locked: boolean;
    prunable: boolean;
    prunableReason: string;
  }> = {};

  const flush = () => {
    if (!current.path) return;
    worktrees.push({
      worktreePath: parsePath(current.path),
      isMain: worktrees.length === 0,
      head: toWorktreeHead(current),
      ...(current.locked ? { locked: true } : {}),
      ...(current.prunable ? { prunable: true } : {}),
      ...(current.prunableReason ? { prunableReason: current.prunableReason } : {}),
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
    else if (line === 'prunable' || line.startsWith('prunable ')) {
      current.prunable = true;
      const reason = line.slice('prunable'.length).trim();
      if (reason) current.prunableReason = reason;
    }
  }
  flush();

  return worktrees;
}

function toWorktreeHead(entry: {
  oid?: string;
  branch?: string;
  detached?: boolean;
}): WorkspaceHostWorktreeHead {
  const oid = entry.oid ?? '';
  if (entry.branch && (!oid || UNBORN_OID.test(oid))) {
    return { kind: 'unborn', name: entry.branch };
  }
  if (entry.branch) return { kind: 'branch', name: entry.branch };
  return { kind: 'detached' };
}
