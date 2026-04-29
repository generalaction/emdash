import type {
  Commit,
  CommitError,
  CommitFile,
  DiffMode,
  DiffResult,
  FetchError,
  FullGitStatus,
  GitChange,
  GitObjectRef,
  MergeBaseRange,
  PullError,
  PushError,
  SoftResetError,
} from '@shared/git';
import type { Result } from '@shared/result';

export interface WorkspaceGitProvider {
  getStatus(): Promise<{ changes: GitChange[]; currentBranch: string | null }>;
  /** Single coalesced status refresh — preferred over separate staged/unstaged calls. */
  getFullStatus(): Promise<FullGitStatus>;
  getStagedChanges(): Promise<{
    changes: GitChange[];
    totalAdded: number;
    totalDeleted: number;
  }>;
  getUnstagedChanges(): Promise<{ changes: GitChange[] }>;
  getCurrentBranch(): Promise<string | null>;
  /** Release persistent git resources (e.g. cat-file --batch). */
  dispose(): void;
  /**
   * Path of this workspace's git admin dir relative to the main repo's `.git`
   * directory (forward slashes). Main worktree returns `''`.
   */
  getWorktreeGitDir(mainDotGitAbs: string): Promise<string>;
  getChangedFiles(base: DiffMode | GitObjectRef | MergeBaseRange): Promise<GitChange[]>;

  getFileDiff(filePath: string, base?: DiffMode | GitObjectRef): Promise<DiffResult>;
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
    base?: GitObjectRef;
    head?: GitObjectRef;
  }): Promise<{ commits: Commit[]; aheadCount: number }>;
  getLatestCommit(): Promise<Commit | null>;
  getCommitFiles(commitHash: string): Promise<CommitFile[]>;

  commit(message: string): Promise<Result<{ hash: string }, CommitError>>;
  fetch(remote?: string): Promise<Result<void, FetchError>>;
  push(preferredRemote?: string): Promise<Result<{ output: string }, PushError>>;
  publishBranch(
    branchName: string,
    remote?: string
  ): Promise<Result<{ output: string }, PushError>>;
  pull(): Promise<Result<{ output: string }, PullError>>;
  softReset(): Promise<Result<{ subject: string; body: string }, SoftResetError>>;
}
