import { BrowserWindow, ipcMain } from 'electron';
import { log } from '../lib/logger';
import { exec, execFile } from 'child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'util';
import {
  getStatus as gitGetStatus,
  getFileDiff as gitGetFileDiff,
  stageFile as gitStageFile,
  stageAllFiles as gitStageAllFiles,
  unstageFile as gitUnstageFile,
  revertFile as gitRevertFile,
  commit as gitCommit,
  push as gitPush,
  pull as gitPull,
  getLog as gitGetLog,
  getLatestCommit as gitGetLatestCommit,
  getCommitFiles as gitGetCommitFiles,
  getCommitFileDiff as gitGetCommitFileDiff,
  softResetLastCommit as gitSoftResetLastCommit,
} from '../services/GitService';
import { prGenerationService } from '../services/PrGenerationService';
import { databaseService } from '../services/DatabaseService';
import { injectIssueFooter } from '../lib/prIssueFooter';
import { getCreatePrBodyPlan } from '../lib/prCreateBodyPlan';
import { patchCurrentPrBodyWithIssueFooter } from '../lib/prIssueFooterPatch';
import { resolveRemoteProjectForWorktreePath } from '../utils/remoteProjectResolver';
import { RemoteGitService } from '../services/RemoteGitService';
import { sshService } from '../services/ssh/SshService';

const remoteGitService = new RemoteGitService(sshService);

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const GIT_STATUS_DEBOUNCE_MS = 500;
const supportsRecursiveWatch = process.platform === 'darwin' || process.platform === 'win32';

type GitStatusWatchEntry = {
  watcher: fs.FSWatcher;
  watchIds: Set<string>;
  debounceTimer?: NodeJS.Timeout;
};

const gitStatusWatchers = new Map<string, GitStatusWatchEntry>();

// Remote polling for SSH projects (replaces fs.watch)
const REMOTE_POLL_INTERVAL_MS = 5000;
type RemoteStatusPollEntry = {
  intervalId: NodeJS.Timeout;
  watchIds: Set<string>;
  lastStatusHash: string;
  connectionId: string;
};
const remoteStatusPollers = new Map<string, RemoteStatusPollEntry>();

const ensureRemoteStatusPoller = (
  taskPath: string,
  connectionId: string
): { success: true; watchId: string } => {
  const watchId = randomUUID();
  const existing = remoteStatusPollers.get(taskPath);
  if (existing) {
    existing.watchIds.add(watchId);
    return { success: true, watchId };
  }

  const entry: RemoteStatusPollEntry = {
    intervalId: setInterval(async () => {
      try {
        const changes = await remoteGitService.getStatusDetailed(connectionId, taskPath);
        // Simple hash: join paths + statuses to detect changes
        const hash = changes.map((c) => `${c.path}:${c.status}:${c.isStaged}`).join('|');
        const poller = remoteStatusPollers.get(taskPath);
        if (!poller) return;
        if (hash !== poller.lastStatusHash) {
          poller.lastStatusHash = hash;
          broadcastGitStatusChange(taskPath);
        }
      } catch {
        // Connection may have dropped — don't crash, just skip this poll
      }
    }, REMOTE_POLL_INTERVAL_MS),
    watchIds: new Set([watchId]),
    lastStatusHash: '',
    connectionId,
  };
  remoteStatusPollers.set(taskPath, entry);
  return { success: true, watchId };
};

const releaseRemoteStatusPoller = (taskPath: string, watchId?: string) => {
  const entry = remoteStatusPollers.get(taskPath);
  if (!entry) return { success: true as const };
  if (watchId) {
    entry.watchIds.delete(watchId);
  }
  if (entry.watchIds.size <= 0) {
    clearInterval(entry.intervalId);
    remoteStatusPollers.delete(taskPath);
  }
  return { success: true as const };
};

/**
 * Validate that a taskPath is an absolute path pointing to a real directory
 * that is a git repository. Returns an error string if invalid, or null if OK.
 */
function validateTaskPath(taskPath: string | undefined): string | null {
  if (!taskPath) return 'Missing taskPath';
  if (!path.isAbsolute(taskPath)) return 'taskPath must be absolute';
  try {
    const stat = fs.statSync(taskPath);
    if (!stat.isDirectory()) return 'taskPath is not a directory';
  } catch {
    return 'taskPath does not exist';
  }
  return null;
}

const broadcastGitStatusChange = (taskPath: string, error?: string) => {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((window) => {
    try {
      window.webContents.send('git:status-changed', { taskPath, error });
    } catch (err) {
      log.debug('[git:watch-status] failed to send status change', err);
    }
  });
};

const ensureGitStatusWatcher = (taskPath: string) => {
  if (!supportsRecursiveWatch) {
    return { success: false as const, error: 'recursive-watch-unsupported' };
  }
  if (!taskPath || !fs.existsSync(taskPath)) {
    return { success: false as const, error: 'workspace-unavailable' };
  }
  const existing = gitStatusWatchers.get(taskPath);
  const watchId = randomUUID();
  if (existing) {
    existing.watchIds.add(watchId);
    return { success: true as const, watchId };
  }
  try {
    const watcher = fs.watch(taskPath, { recursive: true }, () => {
      const entry = gitStatusWatchers.get(taskPath);
      if (!entry) return;
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
      entry.debounceTimer = setTimeout(() => {
        broadcastGitStatusChange(taskPath);
      }, GIT_STATUS_DEBOUNCE_MS);
    });
    watcher.on('error', (error) => {
      log.warn('[git:watch-status] watcher error', error);
      const entry = gitStatusWatchers.get(taskPath);
      if (entry?.debounceTimer) clearTimeout(entry.debounceTimer);
      try {
        entry?.watcher.close();
      } catch {}
      gitStatusWatchers.delete(taskPath);
      broadcastGitStatusChange(taskPath, 'watcher-error');
    });
    gitStatusWatchers.set(taskPath, { watcher, watchIds: new Set([watchId]) });
    return { success: true as const, watchId };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Failed to watch workspace',
    };
  }
};

const releaseGitStatusWatcher = (taskPath: string, watchId?: string) => {
  const entry = gitStatusWatchers.get(taskPath);
  if (!entry) return { success: true as const };
  if (watchId) {
    entry.watchIds.delete(watchId);
  }
  if (entry.watchIds.size <= 0) {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.watcher.close();
    gitStatusWatchers.delete(taskPath);
  }
  return { success: true as const };
};

export function registerGitIpc() {
  function resolveGitBin(): string {
    // Allow override via env
    const fromEnv = (process.env.GIT_PATH || '').trim();
    const candidates = [
      fromEnv,
      '/opt/homebrew/bin/git',
      '/usr/local/bin/git',
      '/usr/bin/git',
    ].filter(Boolean) as string[];
    for (const p of candidates) {
      try {
        if (p && fs.existsSync(p)) return p;
      } catch {}
    }
    // Last resort: try /usr/bin/env git
    return 'git';
  }
  const GIT = resolveGitBin();

  // Helper: commit-and-push for remote SSH projects
  async function commitAndPushRemote(
    connectionId: string,
    taskPath: string,
    opts: { commitMessage: string; createBranchIfOnDefault: boolean; branchPrefix: string }
  ): Promise<{ success: boolean; branch?: string; output?: string; error?: string }> {
    const { commitMessage, createBranchIfOnDefault, branchPrefix } = opts;

    // Verify git repo
    const verifyResult = await remoteGitService.execGit(
      connectionId,
      taskPath,
      'rev-parse --is-inside-work-tree'
    );
    if (verifyResult.exitCode !== 0) {
      return { success: false, error: 'Not a git repository' };
    }

    let activeBranch = await remoteGitService.getCurrentBranch(connectionId, taskPath);
    const defaultBranch = await remoteGitService.getDefaultBranchName(connectionId, taskPath);

    // Create feature branch if on default
    if (createBranchIfOnDefault && (!activeBranch || activeBranch === defaultBranch)) {
      const short = Date.now().toString(36);
      const name = `${branchPrefix}/${short}`;
      await remoteGitService.createBranch(connectionId, taskPath, name);
      activeBranch = name;
    }

    // Check for changes
    const statusResult = await remoteGitService.execGit(
      connectionId,
      taskPath,
      'status --porcelain --untracked-files=all'
    );
    const hasWorkingChanges = Boolean(statusResult.stdout?.trim());

    // Read staged files
    const readRemoteStagedFiles = async (): Promise<string[]> => {
      const r = await remoteGitService.execGit(connectionId, taskPath, 'diff --cached --name-only');
      return (r.stdout || '')
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean);
    };

    let stagedFiles = await readRemoteStagedFiles();

    // Auto-stage if nothing staged yet
    if (hasWorkingChanges && stagedFiles.length === 0) {
      await remoteGitService.stageAllFiles(connectionId, taskPath);
    }

    // Unstage plan mode artifacts
    await remoteGitService.execGit(connectionId, taskPath, 'reset -q .emdash 2>/dev/null || true');
    await remoteGitService.execGit(
      connectionId,
      taskPath,
      'reset -q PLANNING.md 2>/dev/null || true'
    );
    await remoteGitService.execGit(
      connectionId,
      taskPath,
      'reset -q planning.md 2>/dev/null || true'
    );

    stagedFiles = await readRemoteStagedFiles();

    // Commit
    if (stagedFiles.length > 0) {
      const commitResult = await remoteGitService.commit(connectionId, taskPath, commitMessage);
      if (commitResult.exitCode !== 0 && !/nothing to commit/i.test(commitResult.stderr || '')) {
        return { success: false, error: commitResult.stderr || 'Commit failed' };
      }
    }

    // Push
    const pushResult = await remoteGitService.push(connectionId, taskPath);
    if (pushResult.exitCode !== 0) {
      const retryResult = await remoteGitService.push(connectionId, taskPath, activeBranch, true);
      if (retryResult.exitCode !== 0) {
        return { success: false, error: retryResult.stderr || 'Push failed' };
      }
    }

    const finalStatus = await remoteGitService.execGit(connectionId, taskPath, 'status -sb');
    return { success: true, branch: activeBranch, output: (finalStatus.stdout || '').trim() };
  }

  // Helper: get PR status for remote SSH projects
  async function getPrStatusRemote(
    connectionId: string,
    taskPath: string
  ): Promise<{ success: boolean; pr?: any; error?: string }> {
    const queryFields = [
      'number',
      'url',
      'state',
      'isDraft',
      'mergeStateStatus',
      'headRefName',
      'baseRefName',
      'title',
      'author',
      'additions',
      'deletions',
      'changedFiles',
    ];
    const fieldsStr = queryFields.join(',');

    const viewResult = await remoteGitService.execGh(
      connectionId,
      taskPath,
      `pr view --json ${fieldsStr} -q .`
    );
    let data =
      viewResult.exitCode === 0 && viewResult.stdout.trim()
        ? JSON.parse(viewResult.stdout.trim())
        : null;

    // Fallback: find by branch name
    if (!data) {
      const branch = await remoteGitService.getCurrentBranch(connectionId, taskPath);
      if (branch) {
        const listResult = await remoteGitService.execGh(
          connectionId,
          taskPath,
          `pr list --head ${quoteGhArg(branch)} --json ${fieldsStr} --limit 1`
        );
        if (listResult.exitCode === 0 && listResult.stdout.trim()) {
          const listData = JSON.parse(listResult.stdout.trim());
          if (Array.isArray(listData) && listData.length > 0) data = listData[0];
        }
      }
    }

    if (!data) return { success: true, pr: null };

    // Compute diff stats if missing
    const asNumber = (v: any): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    if (
      asNumber(data.additions) === null ||
      asNumber(data.deletions) === null ||
      asNumber(data.changedFiles) === null
    ) {
      const baseRef = typeof data.baseRefName === 'string' ? data.baseRefName.trim() : '';
      const targetRef = baseRef ? `origin/${baseRef}` : '';
      const cmd = targetRef
        ? `diff --shortstat ${quoteGhArg(targetRef)}...HEAD`
        : 'diff --shortstat HEAD~1..HEAD';
      const diffResult = await remoteGitService.execGit(connectionId, taskPath, cmd);
      if (diffResult.exitCode === 0) {
        const m = (diffResult.stdout || '').match(
          /(\d+)\s+files? changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/
        );
        if (m) {
          if (asNumber(data.changedFiles) === null && m[1]) data.changedFiles = parseInt(m[1], 10);
          if (asNumber(data.additions) === null && m[2]) data.additions = parseInt(m[2], 10);
          if (asNumber(data.deletions) === null && m[3]) data.deletions = parseInt(m[3], 10);
        }
      }
    }

    return { success: true, pr: data };
  }

  // Helper: create PR for remote SSH projects
  async function createPrRemote(
    connectionId: string,
    taskPath: string,
    opts: {
      title?: string;
      body?: string;
      base?: string;
      head?: string;
      draft?: boolean;
      web?: boolean;
      fill?: boolean;
    }
  ): Promise<{ success: boolean; url?: string; output?: string; error?: string; code?: string }> {
    const { title, body, base, head, draft, web, fill } = opts;
    const outputs: string[] = [];

    // Enrich body with issue footer
    let prBody = body;
    try {
      const task = await databaseService.getTaskByPath(taskPath);
      prBody = injectIssueFooter(body, task?.metadata);
    } catch {
      // Non-fatal
    }

    const {
      shouldPatchFilledBody,
      shouldUseBodyFile: _unused,
      shouldUseFill,
    } = getCreatePrBodyPlan({
      fill,
      title,
      rawBody: body,
      enrichedBody: prBody,
    });

    // Stage and commit pending changes
    const statusResult = await remoteGitService.execGit(
      connectionId,
      taskPath,
      'status --porcelain --untracked-files=all'
    );
    if (statusResult.stdout?.trim()) {
      await remoteGitService.stageAllFiles(connectionId, taskPath);
      const commitResult = await remoteGitService.commit(
        connectionId,
        taskPath,
        'stagehand: prepare pull request'
      );
      if (commitResult.exitCode !== 0 && !/nothing to commit/i.test(commitResult.stderr || '')) {
        outputs.push(commitResult.stderr || '');
      }
    }

    // Push branch
    const pushResult = await remoteGitService.push(connectionId, taskPath);
    if (pushResult.exitCode !== 0) {
      const branch = await remoteGitService.getCurrentBranch(connectionId, taskPath);
      const retryResult = await remoteGitService.push(connectionId, taskPath, branch, true);
      if (retryResult.exitCode !== 0) {
        return {
          success: false,
          error:
            'Failed to push branch to origin. Please check your Git remotes and authentication.',
        };
      }
    }
    outputs.push('git push: success');

    // Resolve repo + branches
    const repoResult = await remoteGitService.execGh(
      connectionId,
      taskPath,
      'repo view --json nameWithOwner -q .nameWithOwner'
    );
    const repoNameWithOwner = (repoResult.stdout || '').trim();
    const currentBranch = await remoteGitService.getCurrentBranch(connectionId, taskPath);
    const defaultBranch = await remoteGitService.getDefaultBranchName(connectionId, taskPath);

    // Validate commits ahead
    const baseRef = base || defaultBranch;
    const aheadResult = await remoteGitService.execGit(
      connectionId,
      taskPath,
      `rev-list --count origin/${quoteGhArg(baseRef)}..HEAD`
    );
    const aheadCount = parseInt((aheadResult.stdout || '0').trim(), 10) || 0;
    if (aheadCount <= 0) {
      return {
        success: false,
        error: `No commits to create a PR. Make a commit on current branch '${currentBranch}' ahead of base '${baseRef}'.`,
      };
    }

    // Build gh pr create command
    const flags: string[] = [];
    if (repoNameWithOwner) flags.push(`--repo ${quoteGhArg(repoNameWithOwner)}`);
    if (title) flags.push(`--title ${quoteGhArg(title)}`);
    // Can't use --body-file on remote, use --body instead
    if (prBody && !shouldUseFill) flags.push(`--body ${quoteGhArg(prBody)}`);
    flags.push(`--base ${quoteGhArg(baseRef)}`);
    if (head) {
      flags.push(`--head ${quoteGhArg(head)}`);
    } else if (currentBranch) {
      const headRef = repoNameWithOwner
        ? `${repoNameWithOwner.split('/')[0]}:${currentBranch}`
        : currentBranch;
      flags.push(`--head ${quoteGhArg(headRef)}`);
    }
    if (draft) flags.push('--draft');
    if (web) flags.push('--web');
    if (shouldUseFill) flags.push('--fill');

    const createResult = await remoteGitService.execGh(
      connectionId,
      taskPath,
      `pr create ${flags.join(' ')}`
    );

    const combined = [createResult.stdout, createResult.stderr].filter(Boolean).join('\n').trim();
    const urlMatch = combined.match(/https?:\/\/\S+/);
    const url = urlMatch ? urlMatch[0] : null;

    if (createResult.exitCode !== 0) {
      const restrictionRe =
        /Auth App access restrictions|authorized OAuth apps|third-parties is limited/i;
      const prExistsRe = /already exists|already has.*pull request|pull request for branch/i;
      let code: string | undefined;
      if (restrictionRe.test(combined)) code = 'ORG_AUTH_APP_RESTRICTED';
      else if (prExistsRe.test(combined)) code = 'PR_ALREADY_EXISTS';
      return { success: false, error: combined, output: combined, code };
    }

    // Patch body if needed
    if (shouldPatchFilledBody && url) {
      try {
        const task = await databaseService.getTaskByPath(taskPath);
        if (task?.metadata) {
          const editBody = injectIssueFooter(undefined, task.metadata);
          if (editBody) {
            await remoteGitService.execGh(
              connectionId,
              taskPath,
              `pr edit --body ${quoteGhArg(editBody)}`
            );
          }
        }
      } catch {
        // Non-fatal
      }
    }

    const out = [...outputs, combined].filter(Boolean).join('\n');
    return { success: true, url: url || undefined, output: out };
  }

  // Helper: merge-to-main for remote SSH projects
  async function mergeToMainRemote(
    connectionId: string,
    taskPath: string
  ): Promise<{ success: boolean; prUrl?: string; error?: string }> {
    const currentBranch = await remoteGitService.getCurrentBranch(connectionId, taskPath);
    const defaultBranch = await remoteGitService.getDefaultBranchName(connectionId, taskPath);

    if (!currentBranch) {
      return { success: false, error: 'Not on a branch (detached HEAD state).' };
    }
    if (currentBranch === defaultBranch) {
      return {
        success: false,
        error: `Already on ${defaultBranch}. Create a feature branch first.`,
      };
    }

    // Stage and commit pending changes
    const statusResult = await remoteGitService.execGit(
      connectionId,
      taskPath,
      'status --porcelain --untracked-files=all'
    );
    if (statusResult.stdout?.trim()) {
      await remoteGitService.stageAllFiles(connectionId, taskPath);
      const commitResult = await remoteGitService.commit(
        connectionId,
        taskPath,
        'chore: prepare for merge to main'
      );
      if (commitResult.exitCode !== 0 && !/nothing to commit/i.test(commitResult.stderr || '')) {
        throw new Error(commitResult.stderr || 'Commit failed');
      }
    }

    // Push
    const pushResult = await remoteGitService.push(connectionId, taskPath);
    if (pushResult.exitCode !== 0) {
      const retryResult = await remoteGitService.push(connectionId, taskPath, currentBranch, true);
      if (retryResult.exitCode !== 0) {
        throw new Error(retryResult.stderr || 'Push failed');
      }
    }

    // Create PR
    let prUrl = '';
    const createResult = await remoteGitService.execGh(
      connectionId,
      taskPath,
      `pr create --fill --base ${quoteGhArg(defaultBranch)}`
    );
    const urlMatch = (createResult.stdout || '').match(/https?:\/\/\S+/);
    prUrl = urlMatch ? urlMatch[0] : '';

    if (createResult.exitCode !== 0) {
      if (!/already exists|already has.*pull request/i.test(createResult.stderr || '')) {
        return { success: false, error: `Failed to create PR: ${createResult.stderr}` };
      }
    }

    // Patch PR body with issue footer
    try {
      const task = await databaseService.getTaskByPath(taskPath);
      if (task?.metadata) {
        const footer = injectIssueFooter(undefined, task.metadata);
        if (footer) {
          await remoteGitService.execGh(
            connectionId,
            taskPath,
            `pr edit --body ${quoteGhArg(footer)}`
          );
        }
      }
    } catch {
      // Non-fatal
    }

    // Merge
    const mergeResult = await remoteGitService.execGh(connectionId, taskPath, 'pr merge --merge');
    if (mergeResult.exitCode !== 0) {
      return {
        success: false,
        error: `PR created but merge failed: ${mergeResult.stderr}`,
        prUrl,
      };
    }
    return { success: true, prUrl };
  }

  // Helper: escape arguments for gh CLI commands run over SSH
  function quoteGhArg(arg: string): string {
    // Use the same POSIX single-quote wrapping as quoteShellArg for consistency
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }

  ipcMain.handle('git:watch-status', async (_, taskPath: string) => {
    const remoteProject = await resolveRemoteProjectForWorktreePath(taskPath);
    if (remoteProject) {
      return ensureRemoteStatusPoller(taskPath, remoteProject.sshConnectionId);
    }
    return ensureGitStatusWatcher(taskPath);
  });

  ipcMain.handle('git:unwatch-status', async (_, taskPath: string, watchId?: string) => {
    const remoteProject = await resolveRemoteProjectForWorktreePath(taskPath);
    if (remoteProject) {
      return releaseRemoteStatusPoller(taskPath, watchId);
    }
    return releaseGitStatusWatcher(taskPath, watchId);
  });

  // Git: Status (moved from Codex IPC)
  ipcMain.handle('git:get-status', async (_, taskPath: string) => {
    try {
      const remoteProject = await resolveRemoteProjectForWorktreePath(taskPath);
      if (remoteProject) {
        const changes = await remoteGitService.getStatusDetailed(
          remoteProject.sshConnectionId,
          taskPath
        );
        return { success: true, changes };
      }
      const changes = await gitGetStatus(taskPath);
      return { success: true, changes };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Git: Per-file diff (moved from Codex IPC)
  ipcMain.handle('git:get-file-diff', async (_, args: { taskPath: string; filePath: string }) => {
    try {
      const remoteProject = await resolveRemoteProjectForWorktreePath(args.taskPath);
      if (remoteProject) {
        const diff = await remoteGitService.getFileDiff(
          remoteProject.sshConnectionId,
          args.taskPath,
          args.filePath
        );
        return { success: true, diff };
      }
      const diff = await gitGetFileDiff(args.taskPath, args.filePath);
      return { success: true, diff };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Git: Stage file
  ipcMain.handle('git:stage-file', async (_, args: { taskPath: string; filePath: string }) => {
    try {
      log.info('Staging file:', { taskPath: args.taskPath, filePath: args.filePath });
      const remoteProject = await resolveRemoteProjectForWorktreePath(args.taskPath);
      if (remoteProject) {
        await remoteGitService.stageFile(
          remoteProject.sshConnectionId,
          args.taskPath,
          args.filePath
        );
      } else {
        await gitStageFile(args.taskPath, args.filePath);
      }
      log.info('File staged successfully:', args.filePath);
      return { success: true };
    } catch (error) {
      log.error('Failed to stage file:', { filePath: args.filePath, error });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Git: Stage all files
  ipcMain.handle('git:stage-all-files', async (_, args: { taskPath: string }) => {
    try {
      log.info('Staging all files:', { taskPath: args.taskPath });
      const remoteProject = await resolveRemoteProjectForWorktreePath(args.taskPath);
      if (remoteProject) {
        await remoteGitService.stageAllFiles(remoteProject.sshConnectionId, args.taskPath);
      } else {
        await gitStageAllFiles(args.taskPath);
      }
      log.info('All files staged successfully');
      return { success: true };
    } catch (error) {
      log.error('Failed to stage all files:', { taskPath: args.taskPath, error });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Git: Unstage file
  ipcMain.handle('git:unstage-file', async (_, args: { taskPath: string; filePath: string }) => {
    try {
      log.info('Unstaging file:', { taskPath: args.taskPath, filePath: args.filePath });
      const remoteProject = await resolveRemoteProjectForWorktreePath(args.taskPath);
      if (remoteProject) {
        await remoteGitService.unstageFile(
          remoteProject.sshConnectionId,
          args.taskPath,
          args.filePath
        );
      } else {
        await gitUnstageFile(args.taskPath, args.filePath);
      }
      log.info('File unstaged successfully:', args.filePath);
      return { success: true };
    } catch (error) {
      log.error('Failed to unstage file:', { filePath: args.filePath, error });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Git: Revert file
  ipcMain.handle('git:revert-file', async (_, args: { taskPath: string; filePath: string }) => {
    try {
      log.info('Reverting file:', { taskPath: args.taskPath, filePath: args.filePath });
      const remoteProject = await resolveRemoteProjectForWorktreePath(args.taskPath);
      let result: { action: string };
      if (remoteProject) {
        result = await remoteGitService.revertFile(
          remoteProject.sshConnectionId,
          args.taskPath,
          args.filePath
        );
      } else {
        result = await gitRevertFile(args.taskPath, args.filePath);
      }
      log.info('File operation completed:', { filePath: args.filePath, action: result.action });
      return { success: true, action: result.action };
    } catch (error) {
      log.error('Failed to revert file:', { filePath: args.filePath, error });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  // Git: Generate PR title and description
  ipcMain.handle(
    'git:generate-pr-content',
    async (
      _,
      args: {
        taskPath: string;
        base?: string;
      }
    ) => {
      const { taskPath, base = 'main' } = args || ({} as { taskPath: string; base?: string });
      try {
        // For remote projects, PR content generation still runs locally — it just needs
        // the diff text. The prGenerationService can get diff data via the now-remote-aware
        // git:get-status and git:get-file-diff handlers, or we pass the taskPath which the
        // service uses with local git commands. For remote, we get the diff over SSH and
        // pass it to the generation service.
        const remoteProject = await resolveRemoteProjectForWorktreePath(taskPath);
        if (remoteProject) {
          const connId = remoteProject.sshConnectionId;
          // Get diff text over SSH
          const diffResult = await remoteGitService.execGit(
            connId,
            taskPath,
            `diff --stat origin/${quoteGhArg(base)}...HEAD`
          );
          const logResult = await remoteGitService.execGit(
            connId,
            taskPath,
            `log --oneline origin/${quoteGhArg(base)}..HEAD`
          );
          const diffText = (diffResult.stdout || '').trim();
          const logText = (logResult.stdout || '').trim();
          // Use simple title/description generation from diff summary
          const lines = logText.split('\n').filter((l) => l.trim());
          const generatedTitle = lines.length === 1 ? lines[0].replace(/^[a-f0-9]+ /, '') : '';
          return {
            success: true,
            title: generatedTitle,
            description: diffText ? `## Changes\n\n\`\`\`\n${diffText}\n\`\`\`` : '',
          };
        }

        // Try to get the task to find which provider was used
        let providerId: string | null = null;
        try {
          const task = await databaseService.getTaskByPath(taskPath);
          if (task?.agentId) {
            providerId = task.agentId;
            log.debug('Found task provider for PR generation', { taskPath, providerId });
          }
        } catch (error) {
          log.debug('Could not lookup task provider', { error });
          // Non-fatal - continue without provider
        }

        const result = await prGenerationService.generatePrContent(taskPath, base, providerId);
        return { success: true, ...result };
      } catch (error) {
        log.error('Failed to generate PR content:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // Git: Create Pull Request via GitHub CLI
  ipcMain.handle(
    'git:create-pr',
    async (
      _,
      args: {
        taskPath: string;
        title?: string;
        body?: string;
        base?: string;
        head?: string;
        draft?: boolean;
        web?: boolean;
        fill?: boolean;
      }
    ) => {
      const { taskPath, title, body, base, head, draft, web, fill } =
        args ||
        ({} as {
          taskPath: string;
          title?: string;
          body?: string;
          base?: string;
          head?: string;
          draft?: boolean;
          web?: boolean;
          fill?: boolean;
        });
      try {
        const remoteProject = await resolveRemoteProjectForWorktreePath(taskPath);
        if (remoteProject) {
          return await createPrRemote(remoteProject.sshConnectionId, taskPath, {
            title,
            body,
            base,
            head,
            draft,
            web,
            fill,
          });
        }

        const outputs: string[] = [];
        let taskMetadata: unknown = undefined;
        let prBody = body;
        try {
          const task = await databaseService.getTaskByPath(taskPath);
          taskMetadata = task?.metadata;
          prBody = injectIssueFooter(body, task?.metadata);
        } catch (error) {
          log.debug('Unable to enrich PR body with issue footer', { taskPath, error });
        }
        const { shouldPatchFilledBody, shouldUseBodyFile, shouldUseFill } = getCreatePrBodyPlan({
          fill,
          title,
          rawBody: body,
          enrichedBody: prBody,
        });

        // Stage and commit any pending changes
        try {
          const { stdout: statusOut } = await execAsync(
            'git status --porcelain --untracked-files=all',
            {
              cwd: taskPath,
            }
          );
          if (statusOut && statusOut.trim().length > 0) {
            const { stdout: addOut, stderr: addErr } = await execAsync('git add -A', {
              cwd: taskPath,
            });
            if (addOut?.trim()) outputs.push(addOut.trim());
            if (addErr?.trim()) outputs.push(addErr.trim());

            const commitMsg = 'stagehand: prepare pull request';
            try {
              const { stdout: commitOut, stderr: commitErr } = await execAsync(
                `git commit -m ${JSON.stringify(commitMsg)}`,
                { cwd: taskPath }
              );
              if (commitOut?.trim()) outputs.push(commitOut.trim());
              if (commitErr?.trim()) outputs.push(commitErr.trim());
            } catch (commitErr) {
              const msg = commitErr instanceof Error ? commitErr.message : String(commitErr);
              if (msg && /nothing to commit/i.test(msg)) {
                outputs.push('git commit: nothing to commit');
              } else {
                throw commitErr;
              }
            }
          }
        } catch (stageErr) {
          log.warn('Failed to stage/commit changes before PR:', stageErr as string);
          // Continue; PR may still be created for existing commits
        }

        // Ensure branch is pushed to origin so PR includes latest commit
        try {
          await execAsync('git push', { cwd: taskPath });
          outputs.push('git push: success');
        } catch (pushErr) {
          try {
            const { stdout: branchOut } = await execAsync('git rev-parse --abbrev-ref HEAD', {
              cwd: taskPath,
            });
            const branch = branchOut.trim();
            await execAsync(`git push --set-upstream origin ${JSON.stringify(branch)}`, {
              cwd: taskPath,
            });
            outputs.push(`git push --set-upstream origin ${branch}: success`);
          } catch (pushErr2) {
            log.error('Failed to push branch before PR:', pushErr2 as string);
            return {
              success: false,
              error:
                'Failed to push branch to origin. Please check your Git remotes and authentication.',
            };
          }
        }

        // Resolve repo owner/name (prefer gh, fallback to parsing origin url)
        let repoNameWithOwner = '';
        try {
          const { stdout: repoOut } = await execAsync(
            'gh repo view --json nameWithOwner -q .nameWithOwner',
            { cwd: taskPath }
          );
          repoNameWithOwner = (repoOut || '').trim();
        } catch {
          try {
            const { stdout: urlOut } = await execAsync('git remote get-url origin', {
              cwd: taskPath,
            });
            const url = (urlOut || '').trim();
            // Handle both SSH and HTTPS forms
            const m =
              url.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i) ||
              url.match(/([^/:]+)[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i);
            if (m) {
              const owner = m[1].includes('github.com') ? m[1].split('github.com').pop() : m[1];
              const repo = m[2] || m[3];
              repoNameWithOwner = `${owner}/${repo}`.replace(/^\/*/, '');
            }
          } catch {}
        }

        // Determine current branch and default base branch (fallback to main)
        let currentBranch = '';
        try {
          const { stdout } = await execAsync('git branch --show-current', { cwd: taskPath });
          currentBranch = (stdout || '').trim();
        } catch {}
        let defaultBranch = 'main';
        try {
          const { stdout } = await execAsync(
            'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
            { cwd: taskPath }
          );
          const db = (stdout || '').trim();
          if (db) defaultBranch = db;
        } catch {
          try {
            const { stdout } = await execAsync(
              'git remote show origin | sed -n "/HEAD branch/s/.*: //p"',
              { cwd: taskPath }
            );
            const db2 = (stdout || '').trim();
            if (db2) defaultBranch = db2;
          } catch {}
        }

        // Guard: ensure there is at least one commit ahead of base
        try {
          const baseRef = base || defaultBranch;
          const { stdout: aheadOut } = await execAsync(
            `git rev-list --count ${JSON.stringify(`origin/${baseRef}`)}..HEAD`,
            { cwd: taskPath }
          );
          const aheadCount = parseInt((aheadOut || '0').trim(), 10) || 0;
          if (aheadCount <= 0) {
            return {
              success: false,
              error: `No commits to create a PR. Make a commit on 
current branch '${currentBranch}' ahead of base '${baseRef}'.`,
            };
          }
        } catch {
          // Non-fatal; continue
        }

        // Build gh pr create command with explicit repo/base/head for reliability
        const flags: string[] = [];
        if (repoNameWithOwner) flags.push(`--repo ${JSON.stringify(repoNameWithOwner)}`);
        if (title) flags.push(`--title ${JSON.stringify(title)}`);

        // Use temp file for body to properly handle newlines and multiline content
        let bodyFile: string | null = null;
        if (shouldUseBodyFile && prBody) {
          try {
            bodyFile = path.join(
              os.tmpdir(),
              `gh-pr-body-${Date.now()}-${Math.random().toString(36).substring(7)}.txt`
            );
            // Write body with actual newlines preserved
            fs.writeFileSync(bodyFile, prBody, 'utf8');
            flags.push(`--body-file ${JSON.stringify(bodyFile)}`);
          } catch (writeError) {
            log.warn('Failed to write body to temp file, falling back to --body flag', {
              writeError,
            });
            // Fallback to direct --body flag if temp file creation fails
            flags.push(`--body ${JSON.stringify(prBody)}`);
          }
        }

        if (base || defaultBranch) flags.push(`--base ${JSON.stringify(base || defaultBranch)}`);
        if (head) {
          flags.push(`--head ${JSON.stringify(head)}`);
        } else if (currentBranch) {
          // Prefer owner:branch form when repo is known; otherwise branch name
          const headRef = repoNameWithOwner
            ? `${repoNameWithOwner.split('/')[0]}:${currentBranch}`
            : currentBranch;
          flags.push(`--head ${JSON.stringify(headRef)}`);
        }
        if (draft) flags.push('--draft');
        if (web) flags.push('--web');
        if (shouldUseFill) flags.push('--fill');

        const cmd = `gh pr create ${flags.join(' ')}`.trim();

        let stdout: string;
        let stderr: string;
        try {
          const result = await execAsync(cmd, { cwd: taskPath });
          stdout = result.stdout || '';
          stderr = result.stderr || '';
        } finally {
          // Clean up temp file if it was created
          if (bodyFile && fs.existsSync(bodyFile)) {
            try {
              fs.unlinkSync(bodyFile);
            } catch (unlinkError) {
              log.debug('Failed to delete temp body file', { bodyFile, unlinkError });
            }
          }
        }
        const out = [...outputs, (stdout || '').trim() || (stderr || '').trim()]
          .filter(Boolean)
          .join('\n');

        // Try to extract PR URL from output
        const urlMatch = out.match(/https?:\/\/\S+/);
        const url = urlMatch ? urlMatch[0] : null;

        if (shouldPatchFilledBody) {
          try {
            const didPatchBody = await patchCurrentPrBodyWithIssueFooter({
              taskPath,
              metadata: taskMetadata,
              execFile: execFileAsync,
              prUrl: url,
            });
            if (didPatchBody) {
              outputs.push('gh pr edit --body-file: success');
            }
          } catch (editError) {
            log.warn('Failed to patch PR body with issue footer after --fill create', {
              taskPath,
              editError,
            });
          }
        }

        return { success: true, url, output: out };
      } catch (error: any) {
        // Capture rich error info from gh/child_process
        const errMsg = typeof error?.message === 'string' ? error.message : String(error);
        const errStdout = typeof error?.stdout === 'string' ? error.stdout : '';
        const errStderr = typeof error?.stderr === 'string' ? error.stderr : '';
        const combined = [errMsg, errStdout, errStderr].filter(Boolean).join('\n').trim();

        // Check for various error conditions
        const restrictionRe =
          /Auth App access restrictions|authorized OAuth apps|third-parties is limited/i;
        const prExistsRe = /already exists|already has.*pull request|pull request for branch/i;

        let code: string | undefined;
        if (restrictionRe.test(combined)) {
          code = 'ORG_AUTH_APP_RESTRICTED';
          log.warn('GitHub org restrictions detected during PR creation');
        } else if (prExistsRe.test(combined)) {
          code = 'PR_ALREADY_EXISTS';
          log.info('PR already exists for branch - push was successful');
        } else {
          log.error('Failed to create PR:', combined || error);
        }

        return {
          success: false,
          error: combined || errMsg || 'Failed to create PR',
          output: combined,
          code,
        } as any;
      }
    }
  );

  // Git: Get PR status for current branch via GitHub CLI
  ipcMain.handle('git:get-pr-status', async (_, args: { taskPath: string }) => {
    const { taskPath } = args || ({} as { taskPath: string });
    try {
      const remoteProject = await resolveRemoteProjectForWorktreePath(taskPath);
      if (remoteProject) {
        return await getPrStatusRemote(remoteProject.sshConnectionId, taskPath);
      }

      // Ensure we're in a git repo
      await execAsync('git rev-parse --is-inside-work-tree', { cwd: taskPath });

      const queryFields = [
        'number',
        'url',
        'state',
        'isDraft',
        'mergeStateStatus',
        'headRefName',
        'baseRefName',
        'title',
        'author',
        'additions',
        'deletions',
        'changedFiles',
      ];
      const cmd = `gh pr view --json ${queryFields.join(',')} -q .`;
      try {
        const { stdout } = await execAsync(cmd, { cwd: taskPath });
        const json = (stdout || '').trim();
        let data = json ? JSON.parse(json) : null;

        // Fallback: If gh pr view didn't find a PR (e.g. detached head, upstream not set, or fresh branch),
        // try finding it by branch name via gh pr list.
        if (!data) {
          try {
            const { stdout: branchOut } = await execAsync('git branch --show-current', {
              cwd: taskPath,
            });
            const currentBranch = branchOut.trim();
            if (currentBranch) {
              const listCmd = `gh pr list --head ${JSON.stringify(currentBranch)} --json ${queryFields.join(',')} --limit 1`;
              const { stdout: listOut } = await execAsync(listCmd, { cwd: taskPath });
              const listJson = (listOut || '').trim();
              const listData = listJson ? JSON.parse(listJson) : [];
              if (listData.length > 0) {
                data = listData[0];
              }
            }
          } catch (fallbackErr) {
            log.warn('Failed to fallback to gh pr list:', fallbackErr);
            // Ignore fallback errors and return original null/error
          }
        }

        if (!data) return { success: false, error: 'No PR data returned' };

        // Fallback: if GH CLI didn't return diff stats, try to compute locally
        const asNumber = (v: any): number | null =>
          typeof v === 'number' && Number.isFinite(v)
            ? v
            : typeof v === 'string' && Number.isFinite(Number.parseInt(v, 10))
              ? Number.parseInt(v, 10)
              : null;

        const hasAdd = asNumber(data?.additions) !== null;
        const hasDel = asNumber(data?.deletions) !== null;
        const hasFiles = asNumber(data?.changedFiles) !== null;

        if (!hasAdd || !hasDel || !hasFiles) {
          const baseRef = typeof data?.baseRefName === 'string' ? data.baseRefName.trim() : '';
          const targetRef = baseRef ? `origin/${baseRef}` : '';
          const shortstatCmd = targetRef
            ? `git diff --shortstat ${JSON.stringify(targetRef)}...HEAD`
            : 'git diff --shortstat HEAD~1..HEAD';
          try {
            const { stdout: diffOut } = await execAsync(shortstatCmd, { cwd: taskPath });
            const statLine = (diffOut || '').trim();
            const m =
              statLine &&
              statLine.match(
                /(\d+)\s+files? changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/
              );
            if (m) {
              const [, filesStr, addStr, delStr] = m;
              if (!hasFiles && filesStr) data.changedFiles = Number.parseInt(filesStr, 10);
              if (!hasAdd && addStr) data.additions = Number.parseInt(addStr, 10);
              if (!hasDel && delStr) data.deletions = Number.parseInt(delStr, 10);
            }
          } catch {
            // best-effort only; ignore failures
          }
        }

        return { success: true, pr: data };
      } catch (err) {
        const msg = String(err as string);
        if (/no pull requests? found/i.test(msg) || /not found/i.test(msg)) {
          return { success: true, pr: null };
        }
        return { success: false, error: msg || 'Failed to query PR status' };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Git: Merge PR via GitHub CLI
  ipcMain.handle(
    'git:merge-pr',
    async (
      _,
      args: {
        taskPath: string;
        prNumber?: number;
        strategy?: 'merge' | 'squash' | 'rebase';
        admin?: boolean;
      }
    ) => {
      const {
        taskPath,
        prNumber,
        strategy = 'merge',
        admin = false,
      } = (args || {}) as {
        taskPath: string;
        prNumber?: number;
        strategy?: 'merge' | 'squash' | 'rebase';
        admin?: boolean;
      };

      try {
        const remoteProject = await resolveRemoteProjectForWorktreePath(taskPath);
        if (remoteProject) {
          const strategyFlag =
            strategy === 'squash' ? '--squash' : strategy === 'rebase' ? '--rebase' : '--merge';
          const ghArgs = ['pr', 'merge'];
          if (typeof prNumber === 'number' && Number.isFinite(prNumber))
            ghArgs.push(String(prNumber));
          ghArgs.push(strategyFlag);
          if (admin) ghArgs.push('--admin');
          const result = await remoteGitService.execGh(
            remoteProject.sshConnectionId,
            taskPath,
            ghArgs.join(' ')
          );
          if (result.exitCode !== 0) {
            const msg = (result.stderr || '') + (result.stdout || '');
            if (/not installed|command not found/i.test(msg)) {
              return { success: false, error: msg, code: 'GH_CLI_UNAVAILABLE' };
            }
            return { success: false, error: msg || 'Failed to merge PR' };
          }
          return {
            success: true,
            output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
          };
        }

        await execFileAsync(GIT, ['rev-parse', '--is-inside-work-tree'], { cwd: taskPath });

        const strategyFlag =
          strategy === 'squash' ? '--squash' : strategy === 'rebase' ? '--rebase' : '--merge';

        const ghArgs = ['pr', 'merge'];
        if (typeof prNumber === 'number' && Number.isFinite(prNumber)) {
          ghArgs.push(String(prNumber));
        }
        ghArgs.push(strategyFlag);
        if (admin) ghArgs.push('--admin');

        try {
          const { stdout, stderr } = await execFileAsync('gh', ghArgs, { cwd: taskPath });
          const output = [stdout, stderr].filter(Boolean).join('\n').trim();
          return { success: true, output };
        } catch (err) {
          const msg = String(err as string);
          if (/not installed|command not found/i.test(msg)) {
            return { success: false, error: msg, code: 'GH_CLI_UNAVAILABLE' };
          }
          const stderr = (err as any)?.stderr;
          const stdout = (err as any)?.stdout;
          const combined = [stderr, stdout, msg].filter(Boolean).join('\n').trim();
          return { success: false, error: combined || 'Failed to merge PR' };
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  // Git: Get CI/CD check runs for current branch via GitHub CLI
  ipcMain.handle('git:get-check-runs', async (_, args: { taskPath: string }) => {
    const { taskPath } = args || ({} as { taskPath: string });
    try {
      const remoteProject = await resolveRemoteProjectForWorktreePath(taskPath);
      if (remoteProject) {
        const connId = remoteProject.sshConnectionId;
        const fields = 'bucket,completedAt,description,event,link,name,startedAt,state,workflow';
        const checksResult = await remoteGitService.execGh(
          connId,
          taskPath,
          `pr checks --json ${fields}`
        );
        if (checksResult.exitCode !== 0) {
          const msg = checksResult.stderr || '';
          if (/no pull requests? found/i.test(msg) || /not found/i.test(msg)) {
            return { success: true, checks: null };
          }
          if (/not installed|command not found/i.test(msg)) {
            return { success: false, error: msg, code: 'GH_CLI_UNAVAILABLE' };
          }
          return { success: false, error: msg || 'Failed to query check runs' };
        }
        const checks = checksResult.stdout.trim() ? JSON.parse(checksResult.stdout.trim()) : [];

        // Fetch html_url from API
        try {
          const shaResult = await remoteGitService.execGh(
            connId,
            taskPath,
            "pr view --json headRefOid --jq '.headRefOid'"
          );
          const sha = shaResult.stdout.trim();
          if (sha) {
            const apiResult = await remoteGitService.execGh(
              connId,
              taskPath,
              `api repos/{owner}/{repo}/commits/${sha}/check-runs --jq '.check_runs | map({name: .name, html_url: .html_url}) | .[]'`
            );
            const urlMap = new Map<string, string>();
            for (const line of apiResult.stdout.trim().split('\n')) {
              if (!line) continue;
              try {
                const entry = JSON.parse(line);
                if (entry.name && entry.html_url) urlMap.set(entry.name, entry.html_url);
              } catch {}
            }
            for (const check of checks) {
              const htmlUrl = urlMap.get(check.name);
              if (htmlUrl) check.link = htmlUrl;
            }
          }
        } catch {
          // Fall back to original link values
        }

        return { success: true, checks };
      }

      await execFileAsync(GIT, ['rev-parse', '--is-inside-work-tree'], { cwd: taskPath });

      const fields = 'bucket,completedAt,description,event,link,name,startedAt,state,workflow';
      try {
        const { stdout } = await execFileAsync('gh', ['pr', 'checks', '--json', fields], {
          cwd: taskPath,
        });
        const json = (stdout || '').trim();
        const checks = json ? JSON.parse(json) : [];

        // Fetch html_url from the GitHub API instead, which always points to the
        // actual check run page on GitHub.
        try {
          const { stdout: shaOut } = await execFileAsync(
            'gh',
            ['pr', 'view', '--json', 'headRefOid', '--jq', '.headRefOid'],
            { cwd: taskPath }
          );
          const sha = shaOut.trim();
          if (sha) {
            const { stdout: apiOut } = await execFileAsync(
              'gh',
              [
                'api',
                `repos/{owner}/{repo}/commits/${sha}/check-runs`,
                '--jq',
                '.check_runs | map({name: .name, html_url: .html_url}) | .[]',
              ],
              { cwd: taskPath }
            );
            const urlMap = new Map<string, string>();
            for (const line of apiOut.trim().split('\n')) {
              if (!line) continue;
              try {
                const entry = JSON.parse(line);
                if (entry.name && entry.html_url) urlMap.set(entry.name, entry.html_url);
              } catch {}
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
      } catch (err) {
        const msg = String(err as string);
        if (/no pull requests? found/i.test(msg) || /not found/i.test(msg)) {
          return { success: true, checks: null };
        }
        if (/not installed|command not found/i.test(msg)) {
          return { success: false, error: msg, code: 'GH_CLI_UNAVAILABLE' };
        }
        return { success: false, error: msg || 'Failed to query check runs' };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Git: Get PR comments and reviews via GitHub CLI
  ipcMain.handle(
    'git:get-pr-comments',
    async (_, args: { taskPath: string; prNumber?: number }) => {
      const { taskPath, prNumber } = args || ({} as { taskPath: string; prNumber?: number });
      try {
        const remoteProject = await resolveRemoteProjectForWorktreePath(taskPath);
        if (remoteProject) {
          const connId = remoteProject.sshConnectionId;
          const ghViewArgs = prNumber
            ? `pr view ${prNumber} --json comments,reviews,number`
            : 'pr view --json comments,reviews,number';
          const viewResult = await remoteGitService.execGh(connId, taskPath, ghViewArgs);
          if (viewResult.exitCode !== 0) {
            const msg = viewResult.stderr || '';
            if (/no pull requests? found/i.test(msg) || /not found/i.test(msg)) {
              return { success: true, comments: [], reviews: [] };
            }
            if (/not installed|command not found/i.test(msg)) {
              return { success: false, error: msg, code: 'GH_CLI_UNAVAILABLE' };
            }
            return { success: false, error: msg || 'Failed to query PR comments' };
          }
          const data = viewResult.stdout.trim()
            ? JSON.parse(viewResult.stdout.trim())
            : { comments: [], reviews: [], number: 0 };
          const comments = data.comments || [];
          const reviews = data.reviews || [];

          // Fetch avatar URLs via REST API
          if (data.number) {
            try {
              const avatarMap = new Map<string, string>();
              const setAvatar = (login: string, url: string) => {
                avatarMap.set(login, url);
                if (login.endsWith('[bot]')) avatarMap.set(login.replace(/\[bot]$/, ''), url);
              };

              const commentsApi = await remoteGitService.execGh(
                connId,
                taskPath,
                `api repos/{owner}/{repo}/issues/${data.number}/comments --jq '.[] | {login: .user.login, avatar_url: .user.avatar_url}'`
              );
              for (const line of commentsApi.stdout.trim().split('\n')) {
                if (!line) continue;
                try {
                  const entry = JSON.parse(line);
                  if (entry.login && entry.avatar_url) setAvatar(entry.login, entry.avatar_url);
                } catch {}
              }

              const reviewsApi = await remoteGitService.execGh(
                connId,
                taskPath,
                `api repos/{owner}/{repo}/pulls/${data.number}/reviews --jq '.[] | {login: .user.login, avatar_url: .user.avatar_url}'`
              );
              for (const line of reviewsApi.stdout.trim().split('\n')) {
                if (!line) continue;
                try {
                  const entry = JSON.parse(line);
                  if (entry.login && entry.avatar_url) setAvatar(entry.login, entry.avatar_url);
                } catch {}
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

        await execFileAsync(GIT, ['rev-parse', '--is-inside-work-tree'], { cwd: taskPath });

        try {
          const ghArgs = ['pr', 'view'];
          if (prNumber) ghArgs.push(String(prNumber));
          ghArgs.push('--json', 'comments,reviews,number');

          const { stdout } = await execFileAsync('gh', ghArgs, { cwd: taskPath });
          const json = (stdout || '').trim();
          const data = json ? JSON.parse(json) : { comments: [], reviews: [], number: 0 };

          const comments = data.comments || [];
          const reviews = data.reviews || [];

          // gh pr view doesn't return avatarUrl for authors.
          // Fetch from the REST API which includes avatar_url (works for GitHub Apps too).
          if (data.number) {
            try {
              const avatarMap = new Map<string, string>();

              const { stdout: commentsApi } = await execFileAsync(
                'gh',
                [
                  'api',
                  `repos/{owner}/{repo}/issues/${data.number}/comments`,
                  '--jq',
                  '.[] | {login: .user.login, avatar_url: .user.avatar_url}',
                ],
                { cwd: taskPath }
              );
              const setAvatar = (login: string, url: string) => {
                avatarMap.set(login, url);
                // REST API returns "app[bot]" while gh CLI returns "app" — store both
                if (login.endsWith('[bot]')) avatarMap.set(login.replace(/\[bot]$/, ''), url);
              };

              for (const line of commentsApi.trim().split('\n')) {
                if (!line) continue;
                try {
                  const entry = JSON.parse(line);
                  if (entry.login && entry.avatar_url) setAvatar(entry.login, entry.avatar_url);
                } catch {}
              }

              const { stdout: reviewsApi } = await execFileAsync(
                'gh',
                [
                  'api',
                  `repos/{owner}/{repo}/pulls/${data.number}/reviews`,
                  '--jq',
                  '.[] | {login: .user.login, avatar_url: .user.avatar_url}',
                ],
                { cwd: taskPath }
              );
              for (const line of reviewsApi.trim().split('\n')) {
                if (!line) continue;
                try {
                  const entry = JSON.parse(line);
                  if (entry.login && entry.avatar_url) setAvatar(entry.login, entry.avatar_url);
                } catch {}
              }

              for (const c of [...comments, ...reviews]) {
                if (c.author?.login) {
                  const avatarUrl = avatarMap.get(c.author.login);
                  if (avatarUrl) c.author.avatarUrl = avatarUrl;
                }
              }
            } catch {
              // Fall back to no avatar URLs — renderer will use GitHub fallback
            }
          }

          return { success: true, comments, reviews };
        } catch (err) {
          const msg = String(err as string);
          if (/no pull requests? found/i.test(msg) || /not found/i.test(msg)) {
            return { success: true, comments: [], reviews: [] };
          }
          if (/not installed|command not found/i.test(msg)) {
            return { success: false, error: msg, code: 'GH_CLI_UNAVAILABLE' };
          }
          return { success: false, error: msg || 'Failed to query PR comments' };
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  // Git: Commit all changes and push current branch (create feature branch if on default)
  ipcMain.handle(
    'git:commit-and-push',
    async (
      _,
      args: {
        taskPath: string;
        commitMessage?: string;
        createBranchIfOnDefault?: boolean;
        branchPrefix?: string;
      }
    ) => {
      const {
        taskPath,
        commitMessage = 'chore: apply task changes',
        createBranchIfOnDefault = true,
        branchPrefix = 'orch',
      } = (args ||
        ({} as {
          taskPath: string;
          commitMessage?: string;
          createBranchIfOnDefault?: boolean;
          branchPrefix?: string;
        })) as {
        taskPath: string;
        commitMessage?: string;
        createBranchIfOnDefault?: boolean;
        branchPrefix?: string;
      };

      try {
        const remoteProject = await resolveRemoteProjectForWorktreePath(taskPath);

        if (remoteProject) {
          return await commitAndPushRemote(remoteProject.sshConnectionId, taskPath, {
            commitMessage,
            createBranchIfOnDefault,
            branchPrefix,
          });
        }

        // Ensure we're in a git repo
        await execAsync('git rev-parse --is-inside-work-tree', { cwd: taskPath });

        // Determine current branch
        const { stdout: currentBranchOut } = await execAsync('git branch --show-current', {
          cwd: taskPath,
        });
        const currentBranch = (currentBranchOut || '').trim();

        // Determine default branch via gh, fallback to main/master
        let defaultBranch = 'main';
        try {
          const { stdout } = await execAsync(
            'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
            { cwd: taskPath }
          );
          const db = (stdout || '').trim();
          if (db) defaultBranch = db;
        } catch {
          try {
            const { stdout } = await execAsync(
              'git remote show origin | sed -n "/HEAD branch/s/.*: //p"',
              { cwd: taskPath }
            );
            const db2 = (stdout || '').trim();
            if (db2) defaultBranch = db2;
          } catch {}
        }

        // Optionally create a new branch if on default
        let activeBranch = currentBranch;
        if (createBranchIfOnDefault && (!currentBranch || currentBranch === defaultBranch)) {
          const short = Date.now().toString(36);
          const name = `${branchPrefix}/${short}`;
          await execAsync(`git checkout -b ${JSON.stringify(name)}`, { cwd: taskPath });
          activeBranch = name;
        }

        // Stage (only if needed) and commit
        try {
          const { stdout: st } = await execAsync('git status --porcelain --untracked-files=all', {
            cwd: taskPath,
          });
          const hasWorkingChanges = Boolean(st && st.trim().length > 0);

          const readStagedFiles = async () => {
            try {
              const { stdout } = await execAsync('git diff --cached --name-only', {
                cwd: taskPath,
              });
              return (stdout || '')
                .split('\n')
                .map((f) => f.trim())
                .filter(Boolean);
            } catch {
              return [];
            }
          };

          let stagedFiles = await readStagedFiles();

          // Only auto-stage everything when nothing is staged yet (preserves manual staging choices)
          if (hasWorkingChanges && stagedFiles.length === 0) {
            await execAsync('git add -A', { cwd: taskPath });
          }

          // Never commit plan mode artifacts
          try {
            await execAsync('git reset -q .emdash || true', { cwd: taskPath });
          } catch {}
          try {
            await execAsync('git reset -q PLANNING.md || true', { cwd: taskPath });
          } catch {}
          try {
            await execAsync('git reset -q planning.md || true', { cwd: taskPath });
          } catch {}

          stagedFiles = await readStagedFiles();

          if (stagedFiles.length > 0) {
            try {
              await execAsync(`git commit -m ${JSON.stringify(commitMessage)}`, {
                cwd: taskPath,
              });
            } catch (commitErr) {
              const msg = commitErr instanceof Error ? commitErr.message : String(commitErr);
              if (!/nothing to commit/i.test(msg)) throw commitErr;
            }
          }
        } catch (e) {
          log.warn('Stage/commit step issue:', e instanceof Error ? e.message : String(e));
          throw e;
        }

        // Push current branch (set upstream if needed)
        try {
          await execAsync('git push', { cwd: taskPath });
        } catch (pushErr) {
          await execAsync(`git push --set-upstream origin ${JSON.stringify(activeBranch)}`, {
            cwd: taskPath,
          });
        }

        const { stdout: out } = await execAsync('git status -sb', { cwd: taskPath });
        return { success: true, branch: activeBranch, output: (out || '').trim() };
      } catch (error) {
        log.error('Failed to commit and push:', error);
        const errObj = error as { stderr?: string; message?: string };
        const errMsg = errObj?.stderr?.trim() || errObj?.message || String(error);
        return { success: false, error: errMsg };
      }
    }
  );

  // Git: Get branch status (current branch, default branch, ahead/behind counts)
  ipcMain.handle('git:get-branch-status', async (_, args: { taskPath: string }) => {
    const { taskPath } = args || ({} as { taskPath: string });

    if (!taskPath) {
      return { success: false, error: 'Path does not exist' };
    }

    const remoteProject = await resolveRemoteProjectForWorktreePath(taskPath);
    if (remoteProject) {
      try {
        const status = await remoteGitService.getBranchStatus(
          remoteProject.sshConnectionId,
          taskPath
        );
        return { success: true, ...status };
      } catch (error) {
        log.error(`getBranchStatus (remote): error for ${taskPath}:`, error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    // Early exit for missing/invalid local path
    if (!fs.existsSync(taskPath)) {
      log.warn(`getBranchStatus: path does not exist: ${taskPath}`);
      return { success: false, error: 'Path does not exist' };
    }

    // Check if it's a git repo - expected to fail often for non-git paths
    try {
      await execFileAsync(GIT, ['rev-parse', '--is-inside-work-tree'], { cwd: taskPath });
    } catch {
      log.warn(`getBranchStatus: not a git repository: ${taskPath}`);
      return { success: false, error: 'Not a git repository' };
    }

    try {
      // Current branch
      const { stdout: currentBranchOut } = await execFileAsync(GIT, ['branch', '--show-current'], {
        cwd: taskPath,
      });
      const branch = (currentBranchOut || '').trim();

      // Determine default branch
      let defaultBranch = 'main';
      try {
        const { stdout } = await execFileAsync(
          'gh',
          ['repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'],
          { cwd: taskPath }
        );
        const db = (stdout || '').trim();
        if (db) defaultBranch = db;
      } catch {
        try {
          // Use symbolic-ref to resolve origin/HEAD then take the last path part
          const { stdout } = await execFileAsync(
            GIT,
            ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
            { cwd: taskPath }
          );
          const line = (stdout || '').trim();
          const last = line.split('/').pop();
          if (last) defaultBranch = last;
        } catch {}
      }

      // Ahead/behind relative to upstream tracking branch
      let ahead = 0;
      let behind = 0;
      try {
        // Best case: compare against the upstream tracking branch (@{upstream})
        const { stdout } = await execFileAsync(
          GIT,
          ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'],
          { cwd: taskPath }
        );
        const parts = (stdout || '').trim().split(/\s+/);
        if (parts.length >= 2) {
          behind = parseInt(parts[0] || '0', 10) || 0;
          ahead = parseInt(parts[1] || '0', 10) || 0;
        }
      } catch {
        try {
          // Fallback: compare against origin/<current-branch>
          const { stdout } = await execFileAsync(
            GIT,
            ['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`],
            { cwd: taskPath }
          );
          const parts = (stdout || '').trim().split(/\s+/);
          if (parts.length >= 2) {
            behind = parseInt(parts[0] || '0', 10) || 0;
            ahead = parseInt(parts[1] || '0', 10) || 0;
          }
        } catch {
          // No upstream — use git status as last resort
          try {
            const { stdout } = await execFileAsync(GIT, ['status', '-sb'], { cwd: taskPath });
            const line = (stdout || '').split(/\n/)[0] || '';
            const m = line.match(/ahead\s+(\d+)/i);
            const n = line.match(/behind\s+(\d+)/i);
            if (m) ahead = parseInt(m[1] || '0', 10) || 0;
            if (n) behind = parseInt(n[1] || '0', 10) || 0;
          } catch {}
        }
      }

      // Count commits ahead of origin/<defaultBranch> (for PR visibility)
      let aheadOfDefault = 0;
      if (branch !== defaultBranch) {
        try {
          const { stdout: countOut } = await execFileAsync(
            GIT,
            ['rev-list', '--count', `origin/${defaultBranch}..HEAD`],
            { cwd: taskPath }
          );
          aheadOfDefault = parseInt(countOut.trim(), 10) || 0;
        } catch {
          // origin/<defaultBranch> may not exist
        }
      }

      return { success: true, branch, defaultBranch, ahead, behind, aheadOfDefault };
    } catch (error) {
      log.error(`getBranchStatus: unexpected error for ${taskPath}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(
    'git:list-remote-branches',
    async (_, args: { projectPath: string; remote?: string }) => {
      const { projectPath, remote = 'origin' } = args || ({} as { projectPath: string });
      if (!projectPath) {
        return { success: false, error: 'projectPath is required' };
      }

      const remoteProject = await resolveRemoteProjectForWorktreePath(projectPath);
      if (remoteProject) {
        try {
          const branches = await remoteGitService.listBranches(
            remoteProject.sshConnectionId,
            projectPath,
            remote
          );
          return { success: true, branches };
        } catch (error) {
          log.error('Failed to list branches (remote):', error);
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      }

      try {
        await execAsync('git rev-parse --is-inside-work-tree', { cwd: projectPath });
      } catch {
        return { success: false, error: 'Not a git repository' };
      }

      try {
        // Check if remote exists before attempting to fetch
        let hasRemote = false;
        try {
          await execFileAsync('git', ['remote', 'get-url', remote], { cwd: projectPath });
          hasRemote = true;
          // Remote exists, try to fetch
          try {
            await execFileAsync('git', ['fetch', '--prune', remote], { cwd: projectPath });
          } catch (fetchError) {
            log.warn('Failed to fetch remote before listing branches', fetchError);
          }
        } catch {
          // Remote doesn't exist, skip fetch and will use local branches instead
          log.debug(`Remote '${remote}' not found, will use local branches`);
        }

        let branches: Array<{ ref: string; remote: string; branch: string; label: string }> = [];

        if (hasRemote) {
          // List remote branches
          const { stdout } = await execFileAsync(
            'git',
            ['for-each-ref', '--format=%(refname:short)', `refs/remotes/${remote}`],
            { cwd: projectPath }
          );

          branches =
            stdout
              ?.split('\n')
              .map((line) => line.trim())
              .filter((line) => line.length > 0)
              .filter((line) => !line.endsWith('/HEAD'))
              .map((ref) => {
                const [remoteAlias, ...rest] = ref.split('/');
                const branch = rest.join('/') || ref;
                return {
                  ref,
                  remote: remoteAlias || remote,
                  branch,
                  label: `${remoteAlias || remote}/${branch}`,
                };
              }) ?? [];

          // Also include local-only branches (not on remote)
          try {
            const { stdout: localStdout } = await execAsync(
              'git for-each-ref --format="%(refname:short)" refs/heads/',
              { cwd: projectPath }
            );

            const remoteBranchNames = new Set(branches.map((b) => b.branch));

            const localOnlyBranches =
              localStdout
                ?.split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
                .filter((branch) => !remoteBranchNames.has(branch))
                .map((branch) => ({
                  ref: branch,
                  remote: '',
                  branch,
                  label: branch,
                })) ?? [];

            branches = [...branches, ...localOnlyBranches];
          } catch (localBranchError) {
            log.warn('Failed to list local branches', localBranchError);
          }
        } else {
          // No remote - list local branches instead
          try {
            const { stdout } = await execAsync(
              'git for-each-ref --format="%(refname:short)" refs/heads/',
              { cwd: projectPath }
            );

            branches =
              stdout
                ?.split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
                .map((branch) => ({
                  ref: branch,
                  remote: '', // No remote
                  branch,
                  label: branch, // Just the branch name, no remote prefix
                })) ?? [];
          } catch (localBranchError) {
            log.warn('Failed to list local branches', localBranchError);
          }
        }

        return { success: true, branches };
      } catch (error) {
        log.error('Failed to list branches:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  // Git: Merge current branch to main via GitHub (create PR + merge immediately)
  ipcMain.handle('git:merge-to-main', async (_, args: { taskPath: string }) => {
    const { taskPath } = args || ({} as { taskPath: string });

    try {
      const remoteProject = await resolveRemoteProjectForWorktreePath(taskPath);
      if (remoteProject) {
        return await mergeToMainRemote(remoteProject.sshConnectionId, taskPath);
      }

      // Get current and default branch names
      const { stdout: currentOut } = await execAsync('git branch --show-current', {
        cwd: taskPath,
      });
      const currentBranch = (currentOut || '').trim();

      let defaultBranch = 'main';
      try {
        const { stdout } = await execAsync(
          'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
          { cwd: taskPath }
        );
        if (stdout?.trim()) defaultBranch = stdout.trim();
      } catch {
        // gh not available or not a GitHub repo - fall back to 'main'
      }

      // Validate: on a valid feature branch
      if (!currentBranch) {
        return { success: false, error: 'Not on a branch (detached HEAD state).' };
      }
      if (currentBranch === defaultBranch) {
        return {
          success: false,
          error: `Already on ${defaultBranch}. Create a feature branch first.`,
        };
      }

      // Stage and commit any pending changes
      const { stdout: statusOut } = await execAsync(
        'git status --porcelain --untracked-files=all',
        { cwd: taskPath }
      );
      if (statusOut?.trim()) {
        await execAsync('git add -A', { cwd: taskPath });
        try {
          await execAsync('git commit -m "chore: prepare for merge to main"', { cwd: taskPath });
        } catch (e) {
          const msg = String(e);
          if (!/nothing to commit/i.test(msg)) throw e;
        }
      }

      // Push branch (set upstream if needed)
      try {
        await execAsync('git push', { cwd: taskPath });
      } catch {
        // No upstream set - push with -u
        await execAsync(`git push --set-upstream origin ${JSON.stringify(currentBranch)}`, {
          cwd: taskPath,
        });
      }

      // Create PR (or use existing)
      let prUrl = '';
      let prExists = false;
      let taskMetadata: unknown = undefined;
      try {
        const task = await databaseService.getTaskByPath(taskPath);
        taskMetadata = task?.metadata;
      } catch (metadataError) {
        log.debug('Unable to load task metadata for merge-to-main issue footer', {
          taskPath,
          metadataError,
        });
      }
      try {
        const prCreateArgs = ['pr', 'create', '--fill', '--base', defaultBranch];
        const { stdout: prOut } = await execFileAsync('gh', prCreateArgs, { cwd: taskPath });
        const urlMatch = prOut?.match(/https?:\/\/\S+/);
        prUrl = urlMatch ? urlMatch[0] : '';
        prExists = true;
      } catch (e) {
        const errMsg = (e as { stderr?: string })?.stderr || String(e);
        if (!/already exists|already has.*pull request/i.test(errMsg)) {
          return { success: false, error: `Failed to create PR: ${errMsg}` };
        }
        // PR already exists - continue to merge
        prExists = true;
      }

      if (prExists) {
        try {
          await patchCurrentPrBodyWithIssueFooter({
            taskPath,
            metadata: taskMetadata,
            execFile: execFileAsync,
            prUrl,
          });
        } catch (editError) {
          log.warn('Failed to patch merge-to-main PR body with issue footer', {
            taskPath,
            editError,
          });
        }
      }

      // Merge PR (branch cleanup happens when workspace is deleted)
      try {
        await execAsync('gh pr merge --merge', { cwd: taskPath });
        return { success: true, prUrl };
      } catch (e) {
        const errMsg = (e as { stderr?: string })?.stderr || String(e);
        return { success: false, error: `PR created but merge failed: ${errMsg}`, prUrl };
      }
    } catch (e) {
      log.error('Failed to merge to main:', e);
      return { success: false, error: (e as { message?: string })?.message || String(e) };
    }
  });

  // Git: Rename branch (local and optionally remote)
  ipcMain.handle(
    'git:rename-branch',
    async (
      _,
      args: {
        repoPath: string;
        oldBranch: string;
        newBranch: string;
      }
    ) => {
      const { repoPath, oldBranch, newBranch } = args;
      try {
        log.info('Renaming branch:', { repoPath, oldBranch, newBranch });

        const remoteProject = await resolveRemoteProjectForWorktreePath(repoPath);
        if (remoteProject) {
          const result = await remoteGitService.renameBranch(
            remoteProject.sshConnectionId,
            repoPath,
            oldBranch,
            newBranch
          );
          return { success: true, remotePushed: result.remotePushed };
        }

        // Check remote tracking BEFORE rename (git branch -m renames config section)
        let remotePushed = false;
        let remoteName = 'origin';
        try {
          const { stdout: remoteOut } = await execFileAsync(
            GIT,
            ['config', '--get', `branch.${oldBranch}.remote`],
            { cwd: repoPath }
          );
          if (remoteOut?.trim()) {
            remoteName = remoteOut.trim();
            remotePushed = true;
          }
        } catch {
          // Branch wasn't tracking a remote, check if it exists on origin
          try {
            const { stdout: lsRemote } = await execFileAsync(
              GIT,
              ['ls-remote', '--heads', 'origin', oldBranch],
              { cwd: repoPath }
            );
            if (lsRemote?.trim()) {
              remotePushed = true;
            }
          } catch {
            // No remote branch
          }
        }

        // Rename local branch
        await execFileAsync(GIT, ['branch', '-m', oldBranch, newBranch], { cwd: repoPath });
        log.info('Local branch renamed successfully');

        // If pushed to remote, delete old and push new
        if (remotePushed) {
          log.info('Branch was pushed to remote, updating remote...');
          try {
            // Delete old remote branch
            await execFileAsync(GIT, ['push', remoteName, '--delete', oldBranch], {
              cwd: repoPath,
            });
            log.info('Deleted old remote branch');
          } catch (deleteErr) {
            // Remote branch might not exist or already deleted
            log.warn('Could not delete old remote branch (may not exist):', deleteErr);
          }

          // Push new branch and set upstream
          await execFileAsync(GIT, ['push', '-u', remoteName, newBranch], { cwd: repoPath });
          log.info('Pushed new branch to remote');
        }

        return { success: true, remotePushed };
      } catch (error) {
        log.error('Failed to rename branch:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle('git:commit', async (_, args: { taskPath: string; message: string }) => {
    try {
      const pathErr = validateTaskPath(args.taskPath);
      if (pathErr) return { success: false, error: pathErr };
      const result = await gitCommit(args.taskPath, args.message);
      broadcastGitStatusChange(args.taskPath);
      return { success: true, hash: result.hash };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('git:push', async (_, args: { taskPath: string }) => {
    try {
      const pathErr = validateTaskPath(args.taskPath);
      if (pathErr) return { success: false, error: pathErr };
      const result = await gitPush(args.taskPath);
      return { success: true, output: result.output };
    } catch (error) {
      const errObj = error as { stderr?: string; message?: string };
      return { success: false, error: errObj?.stderr?.trim() || errObj?.message || String(error) };
    }
  });

  ipcMain.handle('git:pull', async (_, args: { taskPath: string }) => {
    try {
      const pathErr = validateTaskPath(args.taskPath);
      if (pathErr) return { success: false, error: pathErr };
      const result = await gitPull(args.taskPath);
      return { success: true, output: result.output };
    } catch (error) {
      const errObj = error as { stderr?: string; message?: string };
      return { success: false, error: errObj?.stderr?.trim() || errObj?.message || String(error) };
    }
  });

  ipcMain.handle(
    'git:get-log',
    async (
      _,
      args: { taskPath: string; maxCount?: number; skip?: number; aheadCount?: number }
    ) => {
      try {
        const pathErr = validateTaskPath(args.taskPath);
        if (pathErr) return { success: false, error: pathErr };
        const result = await gitGetLog(args.taskPath, args.maxCount, args.skip, args.aheadCount);
        return { success: true, commits: result.commits, aheadCount: result.aheadCount };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle('git:get-latest-commit', async (_, args: { taskPath: string }) => {
    try {
      const pathErr = validateTaskPath(args.taskPath);
      if (pathErr) return { success: false, error: pathErr };
      const commit = await gitGetLatestCommit(args.taskPath);
      return { success: true, commit };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(
    'git:get-commit-files',
    async (_, args: { taskPath: string; commitHash: string }) => {
      try {
        const pathErr = validateTaskPath(args.taskPath);
        if (pathErr) return { success: false, error: pathErr };
        if (!/^[0-9a-f]{4,40}$/i.test(args.commitHash)) {
          return { success: false, error: 'Invalid commit hash' };
        }
        const files = await gitGetCommitFiles(args.taskPath, args.commitHash);
        return { success: true, files };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    'git:get-commit-file-diff',
    async (_, args: { taskPath: string; commitHash: string; filePath: string }) => {
      try {
        const pathErr = validateTaskPath(args.taskPath);
        if (pathErr) return { success: false, error: pathErr };
        if (!/^[0-9a-f]{4,40}$/i.test(args.commitHash)) {
          return { success: false, error: 'Invalid commit hash' };
        }
        // filePath is validated by path.resolve check in GitService.getCommitFileDiff
        const diff = await gitGetCommitFileDiff(args.taskPath, args.commitHash, args.filePath);
        return { success: true, diff };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle('git:soft-reset', async (_, args: { taskPath: string }) => {
    try {
      const pathErr = validateTaskPath(args.taskPath);
      if (pathErr) return { success: false, error: pathErr };
      const result = await gitSoftResetLastCommit(args.taskPath);
      broadcastGitStatusChange(args.taskPath);
      return { success: true, subject: result.subject, body: result.body };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
