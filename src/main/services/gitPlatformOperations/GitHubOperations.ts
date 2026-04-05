import type { GitPlatform } from '../../../shared/git/platform';
import type { ListOpts, NormalizedPrStatus } from '../GitPlatformService';
import {
  buildStatusCommand,
  buildStatusListFallbackCommand,
  isCliNotInstalledError,
  isPrNotFoundError,
  parseStatusResponse,
} from '../GitPlatformService';
import { getDefaultBranchFallback, stripCliPrefix, parseFirstFromList } from './shared';
import type {
  CommandExecutor,
  GitPlatformOperations,
  PrDetails,
  PrListResult,
  CheckRunResult,
  CommentResult,
} from './types';

// ---------------------------------------------------------------------------
// GitHubServiceLike — minimal interface used by GitHubOperations
// ---------------------------------------------------------------------------

export interface GitHubServiceLike {
  getPullRequests(
    projectPath: string,
    opts?: { limit?: number; searchQuery?: string }
  ): Promise<{ prs: any[]; totalCount: number }>;
  getPullRequestDetails(
    projectPath: string,
    prNumber: number
  ): Promise<{
    baseRefName: string;
    headRefName: string;
    url: string;
    title?: string;
    number?: number;
  } | null>;
  ensurePullRequestBranch(
    projectPath: string,
    prNumber: number,
    branchName: string
  ): Promise<string | void>;
}

// ---------------------------------------------------------------------------
// GitHubOperations
// ---------------------------------------------------------------------------

export class GitHubOperations implements GitPlatformOperations {
  readonly platform: GitPlatform = 'github';
  readonly executor: CommandExecutor;

  private readonly githubService: GitHubServiceLike;

  constructor(executor: CommandExecutor, githubService: GitHubServiceLike) {
    this.executor = executor;
    this.githubService = githubService;
  }

  // -------------------------------------------------------------------------
  // getDefaultBranch
  // -------------------------------------------------------------------------

  async getDefaultBranch(): Promise<string> {
    const { exitCode, stdout } = await this.executor.execPlatformCli(
      'repo view --json defaultBranchRef -q .defaultBranchRef.name'
    );
    if (exitCode === 0 && stdout.trim()) {
      return stdout.trim();
    }
    return getDefaultBranchFallback(this.executor);
  }

  // -------------------------------------------------------------------------
  // getPrStatus
  // -------------------------------------------------------------------------

  async getPrStatus(prNumber?: number): Promise<NormalizedPrStatus | null> {
    // When no prNumber, go directly to branch-based fallback to avoid gh pr view
    // returning interactive or ambiguous output.
    if (typeof prNumber !== 'number') {
      const result = await this.findPrByBranch();
      if (result) return result;

      // Fork fallback: check if this repo is a fork and search parent
      const fork = await this.detectForkParent();
      if (fork) {
        const { stdout: branchOut } = await this.executor.execGit('branch --show-current');
        const branch = branchOut.trim();
        if (branch) {
          return this.findPrInParentRepo(fork.parentRepo, fork.forkOwner, branch);
        }
      }
      return null;
    }

    const fullCmd = buildStatusCommand('github', prNumber);
    if (!fullCmd) {
      return this.findPrByBranch();
    }

    const args = stripCliPrefix('github', fullCmd);

    const { exitCode, stdout } = await this.executor.execPlatformCli(args);
    if (exitCode !== 0) {
      return null;
    }

    return parseStatusResponse('github', stdout);
  }

  // -------------------------------------------------------------------------
  // listPullRequests
  // -------------------------------------------------------------------------

  async listPullRequests(opts: ListOpts): Promise<PrListResult> {
    const result = await this.githubService.getPullRequests(this.executor.cwd, {
      limit: opts.limit,
      searchQuery: opts.searchQuery,
    });
    return { prs: result.prs, totalCount: result.totalCount };
  }

  // -------------------------------------------------------------------------
  // getPrDetails
  // -------------------------------------------------------------------------

  async getPrDetails(prNumber: number): Promise<PrDetails | null> {
    const details = await this.githubService.getPullRequestDetails(this.executor.cwd, prNumber);
    if (!details) return null;
    return {
      baseRefName: details.baseRefName,
      headRefName: details.headRefName,
      url: details.url,
    };
  }

  // -------------------------------------------------------------------------
  // getSourceBranch
  // -------------------------------------------------------------------------

  async getSourceBranch(_prNumber: number): Promise<string | null> {
    // GitHub doesn't need this — PR worktree checkout uses PR number directly
    return null;
  }

  // -------------------------------------------------------------------------
  // ensurePrBranch
  // -------------------------------------------------------------------------

  async ensurePrBranch(prNumber: number, branchName: string): Promise<void> {
    await this.githubService.ensurePullRequestBranch(this.executor.cwd, prNumber, branchName);
  }

  // -------------------------------------------------------------------------
  // getCheckRuns
  // -------------------------------------------------------------------------

  async getCheckRuns(): Promise<CheckRunResult> {
    const fields = 'bucket,completedAt,description,event,link,name,startedAt,state,workflow';

    // Detect fork context so we can query the parent repo if needed
    let checksArgs = `pr checks --json ${fields}`;
    let apiRepoPath = 'repos/{owner}/{repo}';
    let headRefOidArgs = 'pr view --json headRefOid --jq .headRefOid';

    const fork = await this.detectForkParent();
    if (fork) {
      const { stdout: brOut } = await this.executor.execGit('branch --show-current');
      const branch = brOut.trim();
      if (branch) {
        const prInParent = await this.findPrInParentRepo(fork.parentRepo, fork.forkOwner, branch);
        if (prInParent) {
          const prNum = prInParent.number;
          const quotedRepo = JSON.stringify(fork.parentRepo);
          checksArgs = `pr checks ${prNum} --repo ${quotedRepo} --json ${fields}`;
          apiRepoPath = `repos/${fork.parentRepo}`;
          headRefOidArgs = `pr view ${prNum} --repo ${quotedRepo} --json headRefOid --jq .headRefOid`;
        }
      }
    }

    const { exitCode, stdout, stderr } = await this.executor.execPlatformCli(checksArgs);

    if (exitCode !== 0) {
      const msg = stderr || '';
      if (isCliNotInstalledError(msg)) {
        return { success: false, checks: null, error: msg, code: 'GH_CLI_UNAVAILABLE' };
      }
      if (isPrNotFoundError('github', msg)) {
        return { success: true, checks: null };
      }
      return { success: false, checks: null, error: msg || 'Failed to query check runs' };
    }

    const checks = stdout.trim() ? JSON.parse(stdout.trim()) : [];

    // Enrich check links with html_url from the GitHub REST API
    try {
      const { exitCode: shaExitCode, stdout: shaOut } =
        await this.executor.execPlatformCli(headRefOidArgs);
      const sha = shaExitCode === 0 ? shaOut.trim() : '';
      if (sha) {
        const { stdout: apiOut } = await this.executor.execPlatformCli(
          `api ${apiRepoPath}/commits/${sha}/check-runs --jq '.check_runs | map({name: .name, html_url: .html_url}) | .[]'`
        );
        const urlMap = new Map<string, string>();
        for (const line of apiOut.trim().split('\n')) {
          if (!line) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.name && entry.html_url) urlMap.set(entry.name, entry.html_url);
          } catch {
            // skip malformed lines
          }
        }
        for (const check of checks) {
          const htmlUrl = urlMap.get(check.name);
          if (htmlUrl) check.link = htmlUrl;
        }
      }
    } catch {
      // Fall back to original link values if API call fails
    }

    return { success: true, checks };
  }

  // -------------------------------------------------------------------------
  // getComments
  // -------------------------------------------------------------------------

  async getComments(prNumber?: number): Promise<CommentResult> {
    const args =
      typeof prNumber === 'number'
        ? `pr view ${prNumber} --json comments,reviews,number`
        : 'pr view --json comments,reviews,number';

    const { exitCode, stdout, stderr } = await this.executor.execPlatformCli(args);

    if (exitCode !== 0) {
      const msg = stderr || '';
      if (isCliNotInstalledError(msg)) {
        return { success: false, error: msg, code: 'GH_CLI_UNAVAILABLE', comments: [] };
      }
      if (isPrNotFoundError('github', msg)) {
        return { success: true, comments: [], reviews: [] };
      }
      return { success: false, error: msg || 'Failed to query PR comments', comments: [] };
    }

    const data = stdout.trim()
      ? JSON.parse(stdout.trim())
      : { comments: [], reviews: [], number: 0 };

    const comments: any[] = data.comments || [];
    const reviews: any[] = data.reviews || [];

    // Enrich with avatar URLs from the GitHub REST API
    if (data.number) {
      try {
        const avatarMap = new Map<string, string>();

        const setAvatar = (login: string, url: string) => {
          avatarMap.set(login, url);
          // REST API may return "app[bot]" while gh CLI returns "app" — store both
          if (login.endsWith('[bot]')) avatarMap.set(login.replace(/\[bot]$/, ''), url);
        };

        const { stdout: commentsApi } = await this.executor.execPlatformCli(
          `api repos/{owner}/{repo}/issues/${data.number}/comments --jq '.[] | {login: .user.login, avatar_url: .user.avatar_url}'`
        );
        for (const line of commentsApi.trim().split('\n')) {
          if (!line) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.login && entry.avatar_url) setAvatar(entry.login, entry.avatar_url);
          } catch {
            // skip malformed lines
          }
        }

        const { stdout: reviewsApi } = await this.executor.execPlatformCli(
          `api repos/{owner}/{repo}/pulls/${data.number}/reviews --jq '.[] | {login: .user.login, avatar_url: .user.avatar_url}'`
        );
        for (const line of reviewsApi.trim().split('\n')) {
          if (!line) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.login && entry.avatar_url) setAvatar(entry.login, entry.avatar_url);
          } catch {
            // skip malformed lines
          }
        }

        for (const c of [...comments, ...reviews]) {
          if (c.author?.login) {
            const avatarUrl = avatarMap.get(c.author.login);
            if (avatarUrl) c.author.avatarUrl = avatarUrl;
          }
        }
      } catch {
        // Fall back to no avatar URLs
      }
    }

    return { success: true, comments, reviews };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async findPrByBranch(): Promise<NormalizedPrStatus | null> {
    const { stdout: branchOut } = await this.executor.execGit('branch --show-current');
    const currentBranch = branchOut.trim();
    if (!currentBranch) return null;

    const args = stripCliPrefix('github', buildStatusListFallbackCommand('github', currentBranch));
    const { exitCode, stdout } = await this.executor.execPlatformCli(args);
    if (exitCode !== 0) return null;

    return parseFirstFromList('github', stdout);
  }

  /**
   * Detect whether the current repo is a fork and return the parent repo info.
   */
  private async detectForkParent(): Promise<{
    parentRepo: string;
    forkOwner: string;
  } | null> {
    try {
      const { exitCode, stdout } = await this.executor.execPlatformCli(
        'repo view --json owner,parent'
      );
      if (exitCode !== 0) return null;

      const repoData = stdout.trim() ? JSON.parse(stdout.trim()) : null;
      const parentOwner = repoData?.parent?.owner?.login;
      const parentName = repoData?.parent?.name;
      if (!parentOwner || !parentName) return null;

      return {
        parentRepo: `${parentOwner}/${parentName}`,
        forkOwner: repoData?.owner?.login || '',
      };
    } catch {
      return null;
    }
  }

  /**
   * Search for a PR in a parent (upstream) repo that matches the current fork's branch.
   */
  private async findPrInParentRepo(
    parentRepo: string,
    forkOwner: string,
    branch: string
  ): Promise<NormalizedPrStatus | null> {
    try {
      const fields =
        'number,url,state,isDraft,mergeStateStatus,headRefName,baseRefName,title,author,additions,deletions,changedFiles,autoMergeRequest,updatedAt,headRepositoryOwner';
      const { exitCode, stdout } = await this.executor.execPlatformCli(
        `pr list --head ${JSON.stringify(branch)} --repo ${JSON.stringify(parentRepo)} --state open --json ${fields} --limit 10`
      );
      if (exitCode !== 0 || !stdout.trim()) return null;

      const data = JSON.parse(stdout.trim());
      if (!Array.isArray(data) || data.length === 0) return null;

      const match = forkOwner
        ? data.find((pr: any) => pr?.headRepositoryOwner?.login === forkOwner)
        : data[0];
      if (!match) return null;

      return parseStatusResponse('github', JSON.stringify(match));
    } catch {
      return null;
    }
  }
}
