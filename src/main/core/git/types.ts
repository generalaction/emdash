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
  getChangedFiles(base: DiffBase): Promise<GitChange[]>;

  getFileDiff(filePath: string, base?: DiffBase): Promise<DiffResult>;
  getFileAtHead(filePath: string): Promise<string | null>;
  getFileAtRef(filePath: string, ref: string): Promise<string | null>;
  getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult>;

  stageFiles(filePaths: string[]): Promise<void>;
  stageAllFiles(): Promise<void>;
  unstageFiles(filePaths: string[]): Promise<void>;
  unstageAllFiles(): Promise<void>;
  revertFiles(filePaths: string[]): Promise<void>;
  revertAllFiles(): Promise<void>;

  getLog(options?: {
    maxCount?: number;
    skip?: number;
    knownAheadCount?: number;
  }): Promise<{ commits: Commit[]; aheadCount: number }>;
  getLatestCommit(): Promise<Commit | null>;
  getCommitFiles(commitHash: string): Promise<CommitFile[]>;

  commit(message: string): Promise<{ hash: string }>;
  fetch(): Promise<void>;
  push(): Promise<Result<{ output: string }, PushError>>;
  publishBranch(branchName: string): Promise<Result<{ output: string }, PushError>>;
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
  getRemotes(): Promise<{ name: string; url: string }[]>;
  createBranch(name: string, from: string, syncWithRemote?: boolean): Promise<void>;
  renameBranch(oldBranch: string, newBranch: string): Promise<{ remotePushed: boolean }>;

  detectInfo(): Promise<GitInfo>;
}
