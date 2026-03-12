export type DiffLine = { left?: string; right?: string; type: 'context' | 'add' | 'del' };

export type GitChange = {
  path: string;
  status: string;
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

export interface IGitProvider {
  getStatus(): Promise<GitChange[]>;
  getFileDiff(filePath: string): Promise<DiffResult>;
  stageFile(filePath: string): Promise<void>;
  stageAllFiles(): Promise<void>;
  unstageFile(filePath: string): Promise<void>;
  revertFile(filePath: string): Promise<{ action: string }>;
  commit(message: string): Promise<{ hash: string }>;
  push(): Promise<{ output: string }>;
  pull(): Promise<{ output: string }>;
  softReset(): Promise<{ subject: string; body: string }>;
  getLog(
    maxCount?: number,
    skip?: number,
    aheadCount?: number
  ): Promise<{ commits: unknown[]; aheadCount: number }>;
  getLatestCommit(): Promise<{
    hash: string;
    subject: string;
    body: string;
    isPushed: boolean;
  } | null>;
  getCommitFiles(
    commitHash: string
  ): Promise<Array<{ path: string; status: string; additions: number; deletions: number }>>;
  getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult>;
  getBranchStatus(): Promise<{
    branch: string;
    defaultBranch: string;
    ahead: number;
    behind: number;
  }>;
  renameBranch(
    repoPath: string,
    oldBranch: string,
    newBranch: string
  ): Promise<{ remotePushed: boolean }>;
  detectInfo(): Promise<GitInfo>;
}
