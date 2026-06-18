import type { DiffMode, GitChange, GitObjectRef, GitRemote } from '@emdash/core/git';

export interface ImageBlob {
  dataUrl: string;
  mimeType: string;
  size: number;
}

/** Why a preview could not be produced, distinct from a real missing image. */
export type ImageUnavailableReason =
  | 'ssh'
  | 'unsupported'
  | 'too-large'
  | 'lfs-pointer'
  | 'git-error';

export type ImageReadResult =
  | { kind: 'image'; image: ImageBlob }
  | { kind: 'missing' }
  | { kind: 'unavailable'; reason: ImageUnavailableReason };

export interface FullGitStatus {
  staged: GitChange[];
  unstaged: GitChange[];
  currentBranch: string | null;
  headKind: 'branch' | 'detached' | 'unborn';
  shortHash: string | null;
  totalAdded: number;
  totalDeleted: number;
}

export interface GitInfo {
  isGitRepo: boolean;
  baseRef: string;
  rootPath: string;
}

export const DEFAULT_REMOTE_NAME = 'origin';

export type ConfiguredRemotes = {
  baseRemote: GitRemote;
  pushRemote: GitRemote;
};

export const HEAD_MODE: DiffMode = { kind: 'head' };
export const HEAD_REF = HEAD_MODE;
export const STAGED_REF: DiffMode = { kind: 'staged' };

export type GitRef = DiffMode | GitObjectRef;

export type FetchError =
  | { type: 'no_remote' }
  | { type: 'auth_failed'; message: string }
  | { type: 'network_error'; message: string }
  | { type: 'remote_not_found'; message: string }
  | { type: 'error'; message: string };

export type FetchPrForReviewError =
  | { type: 'not_found'; prNumber: number }
  | { type: 'error'; message: string };

export type CommitError =
  | { type: 'empty_message' }
  | { type: 'nothing_to_commit' }
  | { type: 'hook_failed'; message: string }
  | { type: 'error'; message: string };

export type CreateBranchError =
  | { type: 'already_exists'; name: string }
  | { type: 'fetch_failed'; remote: string; branch: string; error: FetchError }
  | { type: 'invalid_base'; from: string }
  | { type: 'invalid_name'; name: string }
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
