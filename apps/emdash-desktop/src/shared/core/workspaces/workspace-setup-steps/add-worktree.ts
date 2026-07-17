export type Args = {
  branchName: string;
};

export type Success = {
  /** Absolute path to the created (or already-existing) worktree. */
  path: string;
};

export type Error =
  | {
      type: 'branch-already-checked-out';
      branchName: string;
      /** Path of the worktree where the branch is currently checked out, if known. */
      candidatePath?: string;
    }
  | { type: 'stale-directory'; path: string }
  | { type: 'worktree-failed'; branchName: string; message: string };
