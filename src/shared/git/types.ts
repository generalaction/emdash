export type GitFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface GitChange {
  path: string;
  status: GitFileStatus;
  additions: number | null;
  deletions: number | null;
  isStaged: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  isMain: boolean;
}

export interface GitStatusFile {
  status: string;
  path: string;
}

export interface GitStatus {
  branch: string;
  isClean: boolean;
  files: GitStatusFile[];
}

export type GitIndexUpdateAction = 'stage' | 'unstage';

export type GitIndexUpdateScope = 'all' | 'paths';

export interface GitIndexUpdateArgs {
  action: GitIndexUpdateAction;
  scope: GitIndexUpdateScope;
  filePaths?: string[];
}
