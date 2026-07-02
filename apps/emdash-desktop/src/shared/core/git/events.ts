import type { GitRepoUpdate, GitWorktreeUpdate } from '@emdash/core/git';
import { defineEvent } from '@shared/lib/ipc/events';

export type GitRepoUpdateEvent = {
  projectId: string;
  update: GitRepoUpdate;
};

export const gitRepoUpdateChannel = defineEvent<GitRepoUpdateEvent>('git:repo-update');

export type GitWorktreeUpdateEvent = {
  projectId: string;
  workspaceId: string;
  update: GitWorktreeUpdate;
};

export const gitWorktreeUpdateChannel = defineEvent<GitWorktreeUpdateEvent>('git:worktree-update');

export type LastTurnBaselineEvent = {
  projectId: string;
  workspaceId: string;
};

/** Fires when the "last turn" diff baseline is (re)captured for a workspace (#1635). */
export const lastTurnBaselineChannel = defineEvent<LastTurnBaselineEvent>('git:last-turn-baseline');
