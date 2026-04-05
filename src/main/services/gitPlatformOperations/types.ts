import type { GitPlatform } from '../../../shared/git/platform';
import type { NormalizedPrStatus, NormalizedPrListItem, ListOpts } from '../GitPlatformService';

// ---------------------------------------------------------------------------
// Command Executor — abstracts local execAsync vs remote SSH execution
// ---------------------------------------------------------------------------

export interface CommandExecutor {
  /** Working directory (local) or task path (remote). */
  readonly cwd: string;

  /** Shell-level exec. Use only when piped commands are unavoidable. */
  exec(cmd: string): Promise<{ stdout: string; stderr: string }>;

  /** Runs git with the given args. */
  execGit(args: string): Promise<{ stdout: string; stderr: string }>;

  /**
   * Runs the platform CLI (gh or glab) with the given args (no CLI prefix).
   * Returns exitCode so callers can distinguish "CLI not found" from "no PR".
   */
  execPlatformCli(args: string): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface PrDetails {
  baseRefName: string;
  headRefName: string;
  url: string;
}

export interface CheckRun {
  name: string;
  state: string;
  bucket: string;
  link: string;
  description: string;
  startedAt: string | null;
  completedAt: string | null;
  workflow?: string;
}

export interface CheckRunResult {
  success: boolean;
  checks: CheckRun[] | null;
  error?: string;
  code?: string;
}

export interface CommentResult {
  success: boolean;
  comments: any[];
  reviews?: any[];
  error?: string;
  code?: string;
}

export interface PrListResult {
  prs: NormalizedPrListItem[];
  totalCount: number;
}

// ---------------------------------------------------------------------------
// Operations interface
// ---------------------------------------------------------------------------

export interface GitPlatformOperations {
  readonly platform: GitPlatform;
  readonly executor: CommandExecutor;

  getDefaultBranch(): Promise<string>;

  getPrStatus(prNumber?: number): Promise<NormalizedPrStatus | null>;

  listPullRequests(opts: ListOpts): Promise<PrListResult>;

  getPrDetails(prNumber: number): Promise<PrDetails | null>;

  getSourceBranch(prNumber: number): Promise<string | null>;

  ensurePrBranch(prNumber: number, branchName: string): Promise<void>;

  getCheckRuns(): Promise<CheckRunResult>;

  getComments(prNumber?: number): Promise<CommentResult>;
}
