import type { IFileSystem } from '../services/fs/types';
import type { DiffResult } from '../../utils/diffParser';
import type { GitChange } from '../../services/GitService';
import type { ExecResult } from '@shared/ssh/types';
import type { ProjectRow } from '../db/schema';

export interface IGitService {
  getStatus(worktreePath: string): Promise<GitChange[]>;
  getFileDiff(worktreePath: string, filePath: string): Promise<DiffResult>;
  stageFile(worktreePath: string, filePath: string): Promise<void>;
  stageAllFiles(worktreePath: string): Promise<void>;
  unstageFile(worktreePath: string, filePath: string): Promise<void>;
  revertFile(worktreePath: string, filePath: string): Promise<{ action: string }>;
  commit(worktreePath: string, message: string): Promise<{ hash: string }>;
  push(worktreePath: string): Promise<{ output: string }>;
  pull(worktreePath: string): Promise<{ output: string }>;
  softReset(worktreePath: string): Promise<{ subject: string; body: string }>;
  getLog(
    worktreePath: string,
    maxCount?: number,
    skip?: number,
    aheadCount?: number
  ): Promise<{ commits: unknown[]; aheadCount: number }>;
  getLatestCommit(
    worktreePath: string
  ): Promise<{ hash: string; subject: string; body: string; isPushed: boolean } | null>;
  getCommitFiles(
    worktreePath: string,
    commitHash: string
  ): Promise<Array<{ path: string; status: string; additions: number; deletions: number }>>;
  getCommitFileDiff(
    worktreePath: string,
    commitHash: string,
    filePath: string
  ): Promise<DiffResult>;
  getBranchStatus(
    worktreePath: string
  ): Promise<{ branch: string; defaultBranch: string; ahead: number; behind: number }>;
  renameBranch(
    repoPath: string,
    oldBranch: string,
    newBranch: string
  ): Promise<{ remotePushed: boolean }>;
}

export interface IShellRunner {
  exec(command: string, cwd: string): Promise<ExecResult>;
}

export interface TaskEnvironment {
  readonly taskId: string;
  readonly fs: IFileSystem;
  readonly git: IGitService;
  readonly shell: IShellRunner;
  readonly transport: 'local' | 'ssh2';
  /** Set when transport === 'ssh2' */
  readonly connectionId?: string;
}

export interface EnvironmentProvider {
  readonly type: string;
  provision(project: ProjectRow, task: { id: string; path: string }): Promise<TaskEnvironment>;
  teardown(taskId: string): Promise<void>;
}
