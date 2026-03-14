import {
  Branch,
  Commit,
  CommitFile,
  DefaultBranch,
  DiffBase,
  DiffResult,
  GitChange,
  GitInfo,
  PullError,
  PushError,
} from '@shared/git';
import type { Result } from '@main/lib/result';

export interface GitProvider {
  getStatus(): Promise<GitChange[]>;

  getFileDiff(filePath: string, base?: DiffBase): Promise<DiffResult>;
  getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult>;

  stageFile(filePath: string): Promise<void>;
  stageAllFiles(): Promise<void>;
  unstageFile(filePath: string): Promise<void>;
  revertFile(filePath: string): Promise<{ action: 'unstaged' | 'reverted' }>;

  getLog(options?: {
    maxCount?: number;
    skip?: number;
    knownAheadCount?: number;
  }): Promise<{ commits: Commit[]; aheadCount: number }>;
  getLatestCommit(): Promise<Commit | null>;
  getCommitFiles(commitHash: string): Promise<CommitFile[]>;

  commit(message: string): Promise<{ hash: string }>;
  push(): Promise<Result<{ output: string }, PushError>>;
  pull(): Promise<Result<{ output: string }, PullError>>;
  softReset(): Promise<{ subject: string; body: string }>;

  getBranchStatus(): Promise<{
    branch: string;
    upstream?: string;
    ahead: number;
    behind: number;
  }>;

  getBranches(): Promise<Branch[]>;
  getDefaultBranch(): Promise<DefaultBranch>;
  renameBranch(oldBranch: string, newBranch: string): Promise<{ remotePushed: boolean }>;

  detectInfo(): Promise<GitInfo>;
}
