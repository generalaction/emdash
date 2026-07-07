export type Args = {
  branchName: string;
  /** Git ref (local branch name, remote/branch, commit SHA) to create the branch from. */
  fromRef: string;
  /** If true, do not set up tracking (--no-track). */
  noTrack?: boolean;
};

export type Success = Record<string, never>;

export type Error =
  | { type: 'already-exists'; branchName: string }
  | { type: 'ref-not-found'; ref: string }
  | { type: 'create-failed'; branchName: string; message: string };
