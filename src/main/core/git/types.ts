import {
  Branch,
  Commit,
  CommitError,
  CommitFile,
  CreateBranchError,
  DefaultBranch,
  DeleteBranchError,
  DiffBase,
  DiffResult,
  FetchError,
  FetchPrRefError,
  GitChange,
  GitHeadState,
  GitInfo,
  PullError,
  PushError,
  RenameBranchError,
  SoftResetError,
} from '@shared/git';
import type { Result } from '@shared/result';

export interface GitProvider {
  getStatus(): Promise<GitChange[]>;
  getChangedFiles(base: DiffBase): Promise<GitChange[]>;

  getFileDiff(filePath: string, base?: DiffBase): Promise<DiffResult>;
  getFileAtHead(filePath: string): Promise<string | null>;
  getFileAtRef(filePath: string, ref: string): Promise<string | null>;
  getFileAtIndex(filePath: string): Promise<string | null>;
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
    preferredRemote?: string;
  }): Promise<{ commits: Commit[]; aheadCount: number }>;
  getLatestCommit(): Promise<Commit | null>;
  getCommitFiles(commitHash: string): Promise<CommitFile[]>;

  commit(message: string): Promise<Result<{ hash: string }, CommitError>>;
  fetch(): Promise<Result<void, FetchError>>;
  push(preferredRemote?: string): Promise<Result<{ output: string }, PushError>>;
  publishBranch(
    branchName: string,
    remote?: string
  ): Promise<Result<{ output: string }, PushError>>;
  pull(): Promise<Result<{ output: string }, PullError>>;
  softReset(): Promise<Result<{ subject: string; body: string }, SoftResetError>>;

  getBranchStatus(): Promise<{
    branch: string;
    upstream?: string;
    ahead: number;
    behind: number;
  }>;

  getBranches(): Promise<Branch[]>;
  getDefaultBranch(remote?: string): Promise<DefaultBranch>;
  getRemotes(): Promise<{ name: string; url: string }[]>;
  addRemote(name: string, url: string): Promise<void>;
  getHeadState(): Promise<GitHeadState>;
  createBranch(
    name: string,
    from: string,
    syncWithRemote?: boolean,
    remote?: string
  ): Promise<Result<void, CreateBranchError>>;
  fetchPrRef(
    prNumber: number,
    localBranchName: string,
    remote?: string
  ): Promise<Result<void, FetchPrRefError>>;
  renameBranch(
    oldBranch: string,
    newBranch: string
  ): Promise<Result<{ remotePushed: boolean }, RenameBranchError>>;
  deleteBranch(branch: string, force?: boolean): Promise<Result<void, DeleteBranchError>>;

  detectInfo(): Promise<GitInfo>;
}
