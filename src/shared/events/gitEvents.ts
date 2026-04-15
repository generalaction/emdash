import type { GitRef } from '@shared/git';
import { defineEvent } from '@shared/ipc/events';

export type GitRefChange = {
  projectId: string;
  kind: 'local-refs' | 'remote-refs' | 'config';
  /** Specific structured refs that changed, when derivable from the FS path.
   *  Absent for packed-refs (ambiguous) and bare HEAD pointer changes. */
  changedRefs?: GitRef[];
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
