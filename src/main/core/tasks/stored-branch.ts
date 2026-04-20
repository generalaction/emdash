import type { Branch } from '@shared/git';

/**
 * The persisted form of a Branch stored in SQLite.
 * Now identical to the lean Branch type — local branches are stored without
 * the optional `remote` field (which is fine since the field is optional).
 */
export type StoredBranch = Branch;

export function toStoredBranch(branch: Branch): StoredBranch {
  return branch;
}

export function fromStoredBranch(branch: StoredBranch): Branch {
  return branch;
}
