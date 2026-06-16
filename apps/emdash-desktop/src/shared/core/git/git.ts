import type { GitBranchRef, GitRemote } from '@emdash/shared/git';

export interface ImageBlob {
  dataUrl: string;
  mimeType: string;
  size: number;
}

/** Why a preview could not be produced — distinguishes a real add/delete
 *  (`missing`) from "we can't show this" (`unavailable`). */
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

export type GitChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'conflicted';

export type GitChange = {
  path: string;
  status: GitChangeStatus;
  additions: number;
  deletions: number;
  indexOid?: string;
};

/** Result of a single coalesced workspace status refresh (staged + unstaged + branch). */
export interface FullGitStatus {
  staged: GitChange[];
  unstaged: GitChange[];
  /**
   * The checked-out branch name, or null when HEAD is detached.
   * Use headKind to distinguish detached HEAD from an unborn branch.
   */
  currentBranch: string | null;
  /**
   * - 'branch': a normal branch is checked out
   * - 'detached': HEAD is detached (e.g. mid-rebase); shortHash is populated
   * - 'unborn': the branch exists but has no commits yet; currentBranch is set
   */
  headKind: 'branch' | 'detached' | 'unborn';
  /** Short commit hash (7 chars). Only set when headKind === 'detached'. */
  shortHash: string | null;
  totalAdded: number;
  totalDeleted: number;
}

export type GitStatusUntrackedMode = 'no' | 'normal';

export interface GitStatusFingerprint {
  hash: string;
  byteLength: number;
}

export interface GitInfo {
  isGitRepo: boolean;
  baseRef: string;
  rootPath: string;
}

/**
 * Workspace-relative diff intent — NOT real git object addresses.
 * Maps directly to git command flags, never to ref strings.
 *   head   → `git diff HEAD`
 *   staged → `git diff --cached`
 */
export type DiffMode = { kind: 'head' } | { kind: 'staged' };

export const HEAD_MODE: DiffMode = { kind: 'head' };

/** Backward-compat aliases — prefer explicit DiffMode values in new code. */
export const HEAD_REF = HEAD_MODE;
export const STAGED_REF: DiffMode = { kind: 'staged' };

/**
 * A real, addressable git object — can appear on either side of a diff.
 *   branch → local or remote branch (GitBranchRef already discriminates)
 *   commit → a specific SHA
 *   tag    → a tag name
 */
export type GitObjectRef =
  | { kind: 'branch'; branch: GitBranchRef }
  | { kind: 'commit'; sha: string }
  | { kind: 'tag'; name: string };

/** Full operand type accepted by diff/log APIs — either a mode or an object ref. */
export type GitRef = DiffMode | GitObjectRef;

/**
 * A three-dot merge-base range: `base...head`.
 * Both sides must be real git object addresses (DiffMode is not valid here).
 */
export type MergeBaseRange = { base: GitObjectRef; head: GitObjectRef };

/** Produce the `base...head` range string for use in git commands. */
export function toRangeString(range: MergeBaseRange): string {
  return `${toRefString(range.base)}...${toRefString(range.head)}`;
}

export function mergeBaseRange(base: GitObjectRef, head: GitObjectRef): MergeBaseRange {
  return { base, head };
}

export function toRefString(ref: GitObjectRef): string {
  switch (ref.kind) {
    case 'branch':
      return ref.branch.type === 'remote'
        ? `${ref.branch.remote.name}/${ref.branch.branch}`
        : ref.branch.branch;
    case 'commit':
      return ref.sha;
    case 'tag':
      return ref.name;
  }
}

/**
 * Convert any GitRef (including DiffMode) to a string suitable for git commands
 * or URI construction. DiffMode variants map to their conventional ref strings.
 */
export function gitRefToString(ref: GitRef): string {
  if (ref.kind === 'head') return 'HEAD';
  if (ref.kind === 'staged') return 'STAGED';
  return toRefString(ref);
}

export function refsEqual(a: GitRef, b: GitRef): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'head':
    case 'staged':
      return true;
    case 'branch': {
      const ab = a.branch;
      const bb = (b as typeof a).branch;
      if (ab.type !== bb.type) return false;
      if (ab.type === 'remote' && bb.type === 'remote') {
        return ab.remote.name === bb.remote.name && ab.branch === bb.branch;
      }
      return ab.branch === bb.branch;
    }
    case 'commit':
      return a.sha === (b as typeof a).sha;
    case 'tag':
      return a.name === (b as typeof a).name;
  }
}

/**
 * Create a remote-branch GitObjectRef.
 * Accepts a full GitRemote object or just a name string (url defaults to '' when unknown).
 */
export function remoteRef(remote: GitRemote | string, branch: string): GitObjectRef {
  const r: GitRemote = typeof remote === 'string' ? { name: remote, url: '' } : remote;
  return { kind: 'branch', branch: { type: 'remote', branch, remote: r } };
}

/** Create a local-branch GitObjectRef. */
export function localRef(branch: string): GitObjectRef {
  return { kind: 'branch', branch: { type: 'local', branch } };
}

export function commitRef(sha: string): GitObjectRef {
  return { kind: 'commit', sha };
}

export type Commit = {
  hash: string;
  parents: string[];
  subject: string;
  body: string;
  author: string;
  date: string;
  isPushed: boolean;
  tags: string[];
};

export type CommitFile = {
  path: string;
  status: GitChangeStatus;
  additions: number;
  deletions: number;
};

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
