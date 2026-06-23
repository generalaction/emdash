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
