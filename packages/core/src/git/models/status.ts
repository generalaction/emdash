export type GitChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'conflicted';

export type GitChange = {
  path: string;
  status: GitChangeStatus;
  additions: number;
  deletions: number;
  indexOid?: string;
};

export type GitStatusData = {
  kind: 'ok';
  staged: GitChange[];
  unstaged: GitChange[];
  stagedAdded: number;
  stagedDeleted: number;
};

export type GitStatusError = {
  kind: 'error';
  message: string;
};

export type GitStatusModel = GitStatusData | { kind: 'too-many-files' } | GitStatusError;

export type GitStatusUntrackedMode = 'no' | 'normal';

export type GitStatusFingerprint = {
  hash: string;
  byteLength: number;
};
