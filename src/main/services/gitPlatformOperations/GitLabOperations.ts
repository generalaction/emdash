import type { GitPlatform } from '../../../shared/git/platform';
import type { ListOpts, NormalizedPrStatus } from '../GitPlatformService';
import {
  buildListCommand,
  buildStatusListFallbackCommand,
  parseListResponse,
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
import { quoteShellArg } from '../../utils/shellEscape';

// ---------------------------------------------------------------------------
// Pipeline status → check run state map
// ---------------------------------------------------------------------------

const PIPELINE_STATE_MAP: Record<string, string> = {
  success: 'SUCCESS',
  failed: 'FAILURE',
  running: 'IN_PROGRESS',
  pending: 'QUEUED',
  canceled: 'CANCELLED',
  skipped: 'SKIPPED',
  created: 'QUEUED',
  manual: 'ACTION_REQUIRED',
  waiting_for_resource: 'QUEUED',
};

// ---------------------------------------------------------------------------
// GitLabOperations
// ---------------------------------------------------------------------------

export class GitLabOperations implements GitPlatformOperations {
  readonly platform: GitPlatform = 'gitlab';
  readonly executor: CommandExecutor;

  constructor(executor: CommandExecutor) {
    this.executor = executor;
  }

  // -------------------------------------------------------------------------
  // getDefaultBranch
  // -------------------------------------------------------------------------

  async getDefaultBranch(): Promise<string> {
    const { exitCode, stdout } = await this.executor.execPlatformCli(
      'api "projects/:id" -q .default_branch'
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
    if (typeof prNumber === 'number') {
      const { exitCode, stdout } = await this.executor.execPlatformCli(
        `api "projects/:id/merge_requests/${prNumber}"`
      );
      if (exitCode !== 0) return null;
      return parseStatusResponse('gitlab', stdout);
    }
    return this.findPrByBranch();
  }

  // -------------------------------------------------------------------------
  // listPullRequests
  // -------------------------------------------------------------------------

  async listPullRequests(opts: ListOpts): Promise<PrListResult> {
    const apiArgs = stripCliPrefix('gitlab', buildListCommand('gitlab', opts));

    const { exitCode, stdout } = await this.executor.execPlatformCli(`${apiArgs} --include`);
    if (exitCode !== 0) {
      return { prs: [], totalCount: 0 };
    }

    const { headers, body } = this.parseGitLabApiResponse(stdout);
    const prs = parseListResponse('gitlab', body);
    const totalHeader = headers['x-total'];
    const totalCount = totalHeader ? parseInt(totalHeader, 10) || 0 : 0;

    return { prs, totalCount };
  }

  // -------------------------------------------------------------------------
  // getPrDetails
  // -------------------------------------------------------------------------

  async getPrDetails(prNumber: number): Promise<PrDetails | null> {
    const mrData = await this.fetchMrData(prNumber);
    if (!mrData) return null;

    return {
      baseRefName: (mrData.target_branch as string) ?? '',
      headRefName: (mrData.source_branch as string) ?? '',
      url: (mrData.web_url as string) ?? '',
    };
  }

  // -------------------------------------------------------------------------
  // getSourceBranch
  // -------------------------------------------------------------------------

  async getSourceBranch(prNumber: number): Promise<string | null> {
    const mrData = await this.fetchMrData(prNumber);
    return (mrData?.source_branch as string) || null;
  }

  // -------------------------------------------------------------------------
  // ensurePrBranch
  // -------------------------------------------------------------------------

  async ensurePrBranch(_prNumber: number, branchName: string): Promise<void> {
    const safeBranch = quoteShellArg(branchName);
    await this.executor.exec(`git fetch origin ${safeBranch}`);
    await this.executor.exec(`git branch --force ${safeBranch} origin/${safeBranch}`);
  }

  // -------------------------------------------------------------------------
  // getCheckRuns
  // -------------------------------------------------------------------------

  async getCheckRuns(): Promise<CheckRunResult> {
    const { stdout: branchOut } = await this.executor.execGit('branch --show-current');
    const branch = branchOut.trim();
    if (!branch) {
      return { success: true, checks: null };
    }

    const pipelinesPath = `projects/:id/pipelines?ref=${encodeURIComponent(branch)}&per_page=1&order_by=updated_at&sort=desc`;
    const { exitCode, stdout } = await this.executor.execPlatformCli(`api "${pipelinesPath}"`);
    if (exitCode !== 0) {
      return { success: true, checks: null };
    }

    let pipelines: Record<string, unknown>[];
    try {
      pipelines = JSON.parse(stdout.trim()) as Record<string, unknown>[];
    } catch {
      return { success: true, checks: null };
    }

    if (!Array.isArray(pipelines) || pipelines.length === 0) {
      return { success: true, checks: null };
    }

    const pipeline = pipelines[0];
    const status = pipeline.status as string | undefined;
    const state = (status && PIPELINE_STATE_MAP[status]) || 'QUEUED';
    const bucket = status === 'success' ? 'pass' : status === 'failed' ? 'fail' : 'pending';

    return {
      success: true,
      checks: [
        {
          name: `Pipeline #${pipeline.id as number}`,
          state,
          bucket,
          link: (pipeline.web_url as string) ?? '',
          description: `Pipeline ${status ?? ''}`,
          startedAt:
            (pipeline.started_at as string | null) ||
            (pipeline.created_at as string | null) ||
            null,
          completedAt: (pipeline.finished_at as string | null) || null,
          workflow: 'CI/CD Pipeline',
        },
      ],
    };
  }

  // -------------------------------------------------------------------------
  // getComments
  // -------------------------------------------------------------------------

  async getComments(_prNumber?: number): Promise<CommentResult> {
    return { success: true, comments: [] };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async fetchMrData(prNumber: number): Promise<Record<string, unknown> | null> {
    try {
      const { exitCode, stdout } = await this.executor.execPlatformCli(
        `api "projects/:id/merge_requests/${prNumber}"`
      );
      if (exitCode !== 0 || !stdout.trim()) return null;
      const data = JSON.parse(stdout.trim());
      return typeof data === 'object' && data !== null ? data : null;
    } catch {
      return null;
    }
  }

  private async findPrByBranch(): Promise<NormalizedPrStatus | null> {
    const { stdout: branchOut } = await this.executor.execGit('branch --show-current');
    const currentBranch = branchOut.trim();
    if (!currentBranch) return null;

    const args = stripCliPrefix('gitlab', buildStatusListFallbackCommand('gitlab', currentBranch));
    const { exitCode, stdout } = await this.executor.execPlatformCli(args);
    if (exitCode !== 0) return null;

    return parseFirstFromList('gitlab', stdout);
  }

  private parseGitLabApiResponse(raw: string): {
    headers: Record<string, string>;
    body: string;
  } {
    const separatorIndex = raw.indexOf('\n\n');
    if (separatorIndex === -1) {
      return { headers: {}, body: raw };
    }

    const headerSection = raw.slice(0, separatorIndex);
    const body = raw.slice(separatorIndex + 2);

    const headers: Record<string, string> = {};
    for (const line of headerSection.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex !== -1) {
        const key = line.slice(0, colonIndex).trim().toLowerCase();
        const value = line.slice(colonIndex + 1).trim();
        headers[key] = value;
      }
    }

    return { headers, body };
  }
}
