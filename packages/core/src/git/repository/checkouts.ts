import type { CheckoutInfo } from '../api/queries';
import type { GitHeadModel } from '../checkout/models/head';

const UNBORN_OID = /^0+$/;

export function parseWorktreeList(stdout: string): CheckoutInfo[] {
  const checkouts: CheckoutInfo[] = [];
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
    checkouts.push({
      checkoutPath: current.path,
      isMain: checkouts.length === 0,
      head: toHeadModel(current),
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

  return checkouts;
}

export function toHeadModel(entry: {
  oid?: string;
  branch?: string;
  detached?: boolean;
}): GitHeadModel {
  const oid = entry.oid ?? '';
  if (entry.branch && (!oid || UNBORN_OID.test(oid))) {
    return { kind: 'unborn', name: entry.branch };
  }
  if (entry.branch) return { kind: 'branch', name: entry.branch, oid };
  return { kind: 'detached', shortHash: oid.slice(0, 7), oid };
}
