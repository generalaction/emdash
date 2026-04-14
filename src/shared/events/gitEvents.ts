import { defineEvent } from '@shared/ipc/events';

export type GitRefChange = {
  projectId: string;
  kind: 'local-refs' | 'remote-refs' | 'config';
};

export const gitRefChangedChannel = defineEvent<GitRefChange>('git:ref-changed');

export type GitWorkspaceChange = {
  projectId: string;
  workspaceId: string;
  /** 'index' = staging area changed (git add/rm/reset)
   *  'head'  = HEAD commit changed (commit, checkout, pull, reset) */
  kind: 'index' | 'head';
};

export const gitWorkspaceChangedChannel = defineEvent<GitWorkspaceChange>('git:workspace-changed');
