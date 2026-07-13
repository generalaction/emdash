import type { DiffMode, GitObjectRef, GitRemote } from '@emdash/core/runtimes/git/api';

export const DEFAULT_REMOTE_NAME = 'origin';

export type ConfiguredRemotes = {
  baseRemote: GitRemote;
  pushRemote: GitRemote;
};

export const HEAD_REF: DiffMode = { kind: 'head' };
export const STAGED_REF: DiffMode = { kind: 'staged' };

export type GitRef = DiffMode | GitObjectRef;
