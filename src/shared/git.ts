export type DiffLine = { left?: string; right?: string; type: 'context' | 'add' | 'del' };

export type GitChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'conflicted';

export type GitChange = {
  path: string;
  status: GitChangeStatus;
  additions: number;
  deletions: number;
  isStaged: boolean;
};

export interface DiffResult {
  lines: DiffLine[];
  isBinary?: boolean;
  originalContent?: string;
  modifiedContent?: string;
}

export interface GitInfo {
  isGitRepo: boolean;
  remote?: string;
  branch?: string;
  baseRef: string;
  rootPath: string;
}

/** @internal Use BranchesPayload.isUnborn / BranchesPayload.currentBranch in the renderer */
export type GitHeadState = {
  headName?: string;
  isUnborn: boolean;
};

type GitRef = string;

export type DiffBase = 'HEAD' | 'staged' | GitRef;

export type Commit = {
  hash: string;
  subject: string;
  body: string;
  author: string;
  date: string;
  isPushed: boolean;
  tags: string[];
};

export type CommitFile = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
};

export type LocalBranch = {
  type: 'local';
  branch: string;
  remote?: string;
  divergence?: {
    ahead: number;
    behind: number;
  };
};

export type RemoteBranch = {
  type: 'remote';
  branch: string;
  remote: string;
};

export type Branch = LocalBranch | RemoteBranch;

export type LocalBranchesPayload = {
  localBranches: LocalBranch[];
  currentBranch: string | null;
  isUnborn: boolean;
};

export type RemoteBranchesPayload = {
  remoteBranches: RemoteBranch[];
  remotes: { name: string; url: string }[];
  gitDefaultBranch: string;
};

/** @deprecated Use LocalBranchesPayload and RemoteBranchesPayload */
export type BranchesPayload = {
  branches: Branch[];
  currentBranch: string | null;
  isUnborn: boolean;
  gitDefaultBranch: string;
  remotes: { name: string; url: string }[];
};

export type BranchStatus = {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
};

export type FetchError =
  | { type: 'no_remote' }
  | { type: 'auth_failed'; message: string }
  | { type: 'network_error'; message: string }
  | { type: 'remote_not_found'; message: string }
  | { type: 'error'; message: string };

export type FetchPrRefError =
  | { type: 'not_found'; prNumber: number }
  | { type: 'error'; message: string };

export type CommitError =
  | { type: 'empty_message' }
  | { type: 'nothing_to_commit' }
  | { type: 'hook_failed'; message: string }
  | { type: 'error'; message: string };

export type SoftResetError =
  | { type: 'initial_commit' }
  | { type: 'already_pushed' }
  | { type: 'error'; message: string };

export type CreateBranchError =
  | { type: 'already_exists'; name: string }
  | { type: 'invalid_base'; from: string }
  | { type: 'invalid_name'; name: string }
  | { type: 'error'; message: string };

export type RenameBranchError =
  | { type: 'already_exists'; name: string }
  | { type: 'remote_push_failed'; message: string }
  | { type: 'error'; message: string };

export type DeleteBranchError =
  | { type: 'unmerged'; branch: string }
  | { type: 'not_found'; branch: string }
  | { type: 'is_current'; branch: string }
  | { type: 'error'; message: string };

export type PushError =
  | { type: 'rejected'; message: string }
  | { type: 'auth_failed'; message: string }
  | { type: 'no_remote'; message?: string }
  | { type: 'hook_rejected'; message: string }
  | { type: 'network_error'; message: string }
  | { type: 'error'; message: string };

export type PullError =
  | { type: 'conflict'; conflictedFiles: string[]; message: string }
  | { type: 'no_upstream'; message: string }
  | { type: 'diverged'; message: string }
  | { type: 'auth_failed'; message: string }
  | { type: 'network_error'; message: string }
  | { type: 'error'; message: string };
