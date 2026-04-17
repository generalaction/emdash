import type { Branch, Remote } from '@shared/git';

export type StoredBranch =
  | {
      type: 'local';
      branch: string;
    }
  | {
      type: 'remote';
      branch: string;
      remote: Remote;
    };

export function toStoredBranch(branch: Branch): StoredBranch {
  if (branch.type === 'remote') {
    return {
      type: 'remote',
      branch: branch.branch,
      remote: branch.remote,
    };
  }
  return {
    type: 'local',
    branch: branch.branch,
  };
}

export function fromStoredBranch(branch: StoredBranch): Branch {
  if (branch.type === 'remote') {
    return {
      type: 'remote',
      branch: branch.branch,
      remote: branch.remote,
    };
  }
  return {
    type: 'local',
    branch: branch.branch,
  };
}
