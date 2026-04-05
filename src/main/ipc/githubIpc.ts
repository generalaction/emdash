import { ipcMain, app, type IpcMainInvokeEvent } from 'electron';
import { log } from '../lib/logger';
import { GitHubService } from '../services/GitHubService';
import { worktreeService } from '../services/WorktreeService';
import { githubCLIInstaller } from '../services/GitHubCLIInstaller';
import { databaseService } from '../services/DatabaseService';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { homedir } from 'os';
import { quoteShellArg } from '../utils/shellEscape';
import { getAppSettings } from '../settings';
import { getPlatformConfig } from '../services/GitPlatformService';
import { getOperations } from '../services/gitPlatformOperations';
import type {
  GitPlatformCreateReviewWorktreeArgs,
  GitPlatformCreateReviewWorktreeResult,
  GitPlatformGetPullRequestBaseDiffArgs,
  GitPlatformGetPullRequestBaseDiffResult,
  GitPlatformListPullRequestsArgs,
  GitPlatformListPullRequestsResult,
} from '../../shared/git/platform';

const execAsync = promisify(exec);
const githubService = new GitHubService();

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

export function registerGithubIpc() {
  ipcMain.handle('github:connect', async (_, projectPath: string) => {
    try {
      // Check if GitHub CLI is authenticated
      const isAuth = await githubService.isAuthenticated();
      if (!isAuth) {
        return { success: false, error: 'GitHub CLI not authenticated' };
      }

      // Get repository info from GitHub CLI
      try {
        const { stdout } = await execAsync(
          'gh repo view --json name,nameWithOwner,defaultBranchRef',
          { cwd: projectPath }
        );
        const repoInfo = JSON.parse(stdout);

        return {
          success: true,
          repository: repoInfo.nameWithOwner,
          branch: repoInfo.defaultBranchRef?.name || 'main',
        };
      } catch (error) {
        return {
          success: false,
          error: 'Repository not found on GitHub or not connected to GitHub CLI',
        };
      }
    } catch (error) {
      log.error('Failed to connect to GitHub:', error);
      return { success: false, error: 'Failed to connect to GitHub' };
    }
  });

  // Start Device Flow authentication with automatic background polling
  ipcMain.handle('github:auth', async () => {
    try {
      return await githubService.startDeviceFlowAuth();
    } catch (error) {
      log.error('GitHub authentication failed:', error);
      return { success: false, error: 'Authentication failed' };
    }
  });

  ipcMain.handle('github:auth:oauth', async () => {
    try {
      const result = await githubService.startOAuthAuth();
      return result;
    } catch (error) {
      log.error('OAuth auth failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Cancel ongoing authentication
  ipcMain.handle('github:auth:cancel', async () => {
    try {
      githubService.cancelAuth();
      return { success: true };
    } catch (error) {
      log.error('Failed to cancel GitHub auth:', error);
      return { success: false, error: 'Failed to cancel' };
    }
  });

  ipcMain.handle('github:isAuthenticated', async () => {
    try {
      return await githubService.isAuthenticated();
    } catch (error) {
      log.error('GitHub authentication check failed:', error);
      return false;
    }
  });

  // GitHub status: installed + authenticated + user
  ipcMain.handle('github:getStatus', async () => {
    try {
      let installed = true;
      try {
        await execAsync('gh --version');
      } catch {
        installed = false;
      }

      let authenticated = false;
      let user: any = null;
      if (installed) {
        try {
          const { stdout } = await execAsync('gh api user');
          user = JSON.parse(stdout);
          authenticated = true;
        } catch {
          authenticated = false;
          user = null;
        }
      }

      return { installed, authenticated, user };
    } catch (error) {
      log.error('GitHub status check failed:', error);
      return { installed: false, authenticated: false };
    }
  });

  ipcMain.handle('github:getUser', async () => {
    try {
      const token = await (githubService as any)['getStoredToken']();
      if (!token) return null;
      return await githubService.getUserInfo(token);
    } catch (error) {
      log.error('Failed to get user info:', error);
      return null;
    }
  });

  ipcMain.handle('github:getRepositories', async () => {
    try {
      const token = await (githubService as any)['getStoredToken']();
      if (!token) throw new Error('Not authenticated');
      return await githubService.getRepositories(token);
    } catch (error) {
      log.error('Failed to get repositories:', error);
      return [];
    }
  });

  ipcMain.handle('github:cloneRepository', async (_, repoUrl: string, localPath: string) => {
    const q = (s: string) => JSON.stringify(s);
    try {
      // Opt-out flag for safety or debugging
      if (process.env.EMDASH_DISABLE_CLONE_CACHE === '1') {
        await execAsync(`git clone ${q(repoUrl)} ${q(localPath)}`);
        return { success: true };
      }

      // Ensure parent directory exists
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // If already a git repo, short‑circuit
      try {
        if (fs.existsSync(path.join(localPath, '.git'))) return { success: true };
      } catch {}

      // Use a local bare mirror cache keyed by normalized URL
      const cacheRoot = path.join(app.getPath('userData'), 'repo-cache');
      if (!fs.existsSync(cacheRoot)) fs.mkdirSync(cacheRoot, { recursive: true });
      const norm = (u: string) => u.replace(/\.git$/i, '').trim();
      const cacheKey = require('crypto').createHash('sha1').update(norm(repoUrl)).digest('hex');
      const mirrorPath = path.join(cacheRoot, `${cacheKey}.mirror`);

      if (!fs.existsSync(mirrorPath)) {
        await execAsync(`git clone --mirror --filter=blob:none ${q(repoUrl)} ${q(mirrorPath)}`);
      } else {
        try {
          await execAsync(`git -C ${q(mirrorPath)} remote set-url origin ${q(repoUrl)}`);
        } catch {}
        await execAsync(`git -C ${q(mirrorPath)} remote update --prune`);
      }

      await execAsync(
        `git clone --reference-if-able ${q(mirrorPath)} --dissociate ${q(repoUrl)} ${q(localPath)}`
      );
      return { success: true };
    } catch (error) {
      log.error('Failed to clone repository via cache:', error);
      try {
        await execAsync(`git clone ${q(repoUrl)} ${q(localPath)}`);
        return { success: true };
      } catch (e2) {
        return { success: false, error: e2 instanceof Error ? e2.message : 'Clone failed' };
      }
    }
  });

  ipcMain.handle('github:logout', async () => {
    try {
      await githubService.logout();
      return { success: true };
    } catch (error) {
      log.error('Failed to logout:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Logout failed' };
    }
  });

  // GitHub issues: list/search/get for the repository at projectPath
  ipcMain.handle('github:issues:list', async (_e, projectPath: string, limit?: number) => {
    if (!projectPath) return { success: false, error: 'Project path is required' };
    try {
      const issues = await githubService.listIssues(projectPath, limit ?? 50);
      return { success: true, issues };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to list issues';
      return { success: false, error: message };
    }
  });

  ipcMain.handle(
    'github:issues:search',
    async (_e, projectPath: string, searchTerm: string, limit?: number) => {
      if (!projectPath) return { success: false, error: 'Project path is required' };
      if (!searchTerm || typeof searchTerm !== 'string') {
        return { success: false, error: 'Search term is required' };
      }
      try {
        const issues = await githubService.searchIssues(projectPath, searchTerm, limit ?? 20);
        return { success: true, issues };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to search issues';
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle('github:issues:get', async (_e, projectPath: string, number: number) => {
    if (!projectPath) return { success: false, error: 'Project path is required' };
    if (!number || !Number.isFinite(number)) {
      return { success: false, error: 'Issue number is required' };
    }
    try {
      const issue = await githubService.getIssue(projectPath, number);
      return { success: !!issue, issue: issue ?? undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to get issue';
      return { success: false, error: message };
    }
  });

  const listPullRequestsHandler = async (
    _: IpcMainInvokeEvent,
    args: GitPlatformListPullRequestsArgs
  ): Promise<GitPlatformListPullRequestsResult> => {
    const projectPath = args?.projectPath;
    if (!projectPath) {
      return { success: false, error: 'Project path is required' };
    }

    try {
      const ops = await getOperations(projectPath);
      const result = await ops.listPullRequests({
        limit: args?.limit,
        searchQuery: args?.searchQuery,
      });
      return { success: true, prs: result.prs, totalCount: result.totalCount };
    } catch (error) {
      log.error('Failed to list pull requests:', error);
      const message =
        error instanceof Error ? error.message : 'Unable to list pull requests via CLI';
      return { success: false, error: message };
    }
  };

  ipcMain.handle('github:listPullRequests', listPullRequestsHandler);
  ipcMain.handle('git-platform:listPullRequests', listPullRequestsHandler);

  const createReviewWorktreeHandler = async (
    _: IpcMainInvokeEvent,
    args: GitPlatformCreateReviewWorktreeArgs
  ): Promise<GitPlatformCreateReviewWorktreeResult> => {
    const { projectPath, projectId, prNumber } =
      args || ({} as GitPlatformCreateReviewWorktreeArgs);

    if (!projectPath || !projectId || !prNumber) {
      return { success: false, error: 'Missing required parameters' };
    }

    const reviewProvider = getAppSettings().defaultProvider || 'claude';

    try {
      const ops = await getOperations(projectPath);
      const { noun } = getPlatformConfig(ops.platform);
      const defaultSlug = slugify(args.prTitle || `${noun}-${prNumber}`) || `${noun}-${prNumber}`;
      const taskName =
        args.taskName && args.taskName.trim().length > 0
          ? args.taskName.trim()
          : `${noun}-${prNumber}-${defaultSlug}`;
      const branchName = args.branchName || `${noun}/${prNumber}`;
      const buildTaskInfo = (taskPath: string, name: string, branch: string) => ({
        id: crypto.randomUUID(),
        projectId,
        name,
        branch,
        path: taskPath,
        status: 'active' as const,
        agentId: reviewProvider,
        useWorktree: true,
        metadata: {
          prNumber,
          prTitle: args.prTitle || null,
        },
      });

      let effectiveBranch = branchName;
      const sourceBranch = await ops.getSourceBranch(prNumber);
      if (sourceBranch) {
        effectiveBranch = sourceBranch;
      }

      const currentWorktrees = await worktreeService.listWorktrees(projectPath);
      const existing = currentWorktrees.find((wt) => wt.branch === effectiveBranch);

      if (existing) {
        const persistedTask = await databaseService.getTaskByPath(existing.path);
        let existingTask =
          persistedTask ?? buildTaskInfo(existing.path, existing.name, effectiveBranch);

        if (persistedTask && !persistedTask.agentId) {
          existingTask = { ...persistedTask, agentId: reviewProvider };
        }

        if (!persistedTask || !persistedTask.agentId) {
          try {
            await databaseService.saveTask(existingTask);
          } catch (dbError) {
            log.warn('Failed to save existing PR review task to database:', dbError);
          }
        }

        return {
          success: true,
          worktree: existing,
          branchName: effectiveBranch,
          taskName: existingTask.name,
          task: existingTask,
        };
      }

      await ops.ensurePrBranch(prNumber, effectiveBranch);

      try {
        const { stdout: wtList } = await execAsync('git worktree list --porcelain', {
          cwd: projectPath,
        });
        const lines = wtList.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i] === `branch refs/heads/${effectiveBranch}`) {
            for (let j = i - 1; j >= 0; j--) {
              if (lines[j].startsWith('worktree ')) {
                const existingPath = lines[j].slice('worktree '.length);
                const taskInfo = buildTaskInfo(existingPath, taskName, effectiveBranch);
                try {
                  await databaseService.saveTask(taskInfo);
                } catch {}
                return {
                  success: true,
                  worktree: {
                    id: taskInfo.id,
                    name: taskName,
                    branch: effectiveBranch,
                    path: existingPath,
                    projectId,
                    status: 'active',
                  },
                  branchName: effectiveBranch,
                  taskName,
                  task: taskInfo,
                };
              }
            }
          }
        }
      } catch {
        // Non-fatal — proceed with worktree creation
      }

      const worktreesDir = path.resolve(projectPath, '..', 'worktrees');
      const slug = slugify(taskName) || `${noun}-${prNumber}`;
      let worktreePath = path.join(worktreesDir, slug);

      if (fs.existsSync(worktreePath)) {
        worktreePath = path.join(worktreesDir, `${slug}-${Date.now()}`);
      }

      const worktree = await worktreeService.createWorktreeFromBranch(
        projectPath,
        taskName,
        effectiveBranch,
        projectId,
        { worktreePath }
      );

      const taskInfo = buildTaskInfo(worktree.path, taskName, effectiveBranch);

      try {
        await databaseService.saveTask(taskInfo);
      } catch (dbError) {
        log.warn('Failed to save PR review task to database:', dbError);
      }

      return { success: true, worktree, branchName: effectiveBranch, taskName, task: taskInfo };
    } catch (error) {
      log.error('Failed to create PR worktree:', error);
      const message = error instanceof Error ? error.message : 'Unable to create review worktree';
      return { success: false, error: message };
    }
  };

  ipcMain.handle('github:createPullRequestWorktree', createReviewWorktreeHandler);
  ipcMain.handle('git-platform:createPullRequestWorktree', createReviewWorktreeHandler);

  const getPullRequestBaseDiffHandler = async (
    _: IpcMainInvokeEvent,
    args: GitPlatformGetPullRequestBaseDiffArgs
  ): Promise<GitPlatformGetPullRequestBaseDiffResult> => {
    const { worktreePath, prNumber } = args || ({} as GitPlatformGetPullRequestBaseDiffArgs);

    if (!worktreePath || !prNumber) {
      return { success: false, error: 'Missing required parameters' };
    }

    try {
      const ops = await getOperations(worktreePath);
      const details = await ops.getPrDetails(prNumber);
      if (!details) {
        return { success: false, error: 'Could not fetch PR details' };
      }
      const { baseRefName, headRefName, url: prUrl } = details;

      try {
        await execAsync(`git fetch origin ${quoteShellArg(baseRefName)}`, { cwd: worktreePath });
      } catch {
        // Best effort — base ref may already be available locally
      }

      let diff: string;
      try {
        const { stdout } = await execAsync(
          `git diff ${quoteShellArg(`origin/${baseRefName}`)}...HEAD`,
          { cwd: worktreePath, maxBuffer: 10 * 1024 * 1024 }
        );
        diff = stdout;
      } catch {
        try {
          const { stdout } = await execAsync(
            `git diff ${quoteShellArg(`origin/${baseRefName}`)} HEAD`,
            { cwd: worktreePath, maxBuffer: 10 * 1024 * 1024 }
          );
          diff = stdout;
        } catch (diffError) {
          return {
            success: false,
            error: diffError instanceof Error ? diffError.message : 'Failed to compute PR diff',
          };
        }
      }

      return {
        success: true,
        diff,
        baseBranch: baseRefName,
        headBranch: headRefName,
        prUrl,
      };
    } catch (error) {
      log.error('Failed to get PR base diff:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get PR diff',
      };
    }
  };

  ipcMain.handle('github:getPullRequestBaseDiff', getPullRequestBaseDiffHandler);
  ipcMain.handle('git-platform:getPullRequestBaseDiff', getPullRequestBaseDiffHandler);

  ipcMain.handle('github:checkCLIInstalled', async () => {
    try {
      return await githubCLIInstaller.isInstalled();
    } catch (error) {
      log.error('Failed to check gh CLI installation:', error);
      return false;
    }
  });

  ipcMain.handle('github:installCLI', async () => {
    try {
      return await githubCLIInstaller.install();
    } catch (error) {
      log.error('Failed to install gh CLI:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Installation failed',
      };
    }
  });

  ipcMain.handle('github:getOwners', async () => {
    try {
      const owners = await githubService.getOwners();
      return { success: true, owners };
    } catch (error) {
      log.error('Failed to get owners:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get owners',
      };
    }
  });

  ipcMain.handle('github:validateRepoName', async (_, name: string, owner: string) => {
    try {
      // First validate format
      const formatValidation = githubService.validateRepositoryName(name);
      if (!formatValidation.valid) {
        return {
          success: true,
          valid: false,
          exists: false,
          error: formatValidation.error,
        };
      }

      // Then check if it exists
      const exists = await githubService.checkRepositoryExists(owner, name);
      if (exists) {
        return {
          success: true,
          valid: true,
          exists: true,
          error: `Repository ${owner}/${name} already exists`,
        };
      }

      return {
        success: true,
        valid: true,
        exists: false,
      };
    } catch (error) {
      log.error('Failed to validate repo name:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Validation failed',
      };
    }
  });

  ipcMain.handle(
    'github:createNewProject',
    async (
      _,
      params: {
        name: string;
        description?: string;
        owner: string;
        isPrivate: boolean;
        gitignoreTemplate?: string;
      }
    ) => {
      let githubRepoCreated = false;
      let localDirCreated = false;
      let repoUrl: string | undefined;
      let localPath: string | undefined;

      try {
        const { name, description, owner, isPrivate, gitignoreTemplate } = params;

        // Validate inputs
        const formatValidation = githubService.validateRepositoryName(name);
        if (!formatValidation.valid) {
          return {
            success: false,
            error: formatValidation.error || 'Invalid repository name',
          };
        }

        // Check if repo already exists
        const exists = await githubService.checkRepositoryExists(owner, name);
        if (exists) {
          return {
            success: false,
            error: `Repository ${owner}/${name} already exists`,
          };
        }

        // Get project directory from settings
        const { getAppSettings } = await import('../settings');
        const settings = getAppSettings();
        const projectDir =
          settings.projects?.defaultDirectory || path.join(homedir(), 'emdash-projects');

        // Ensure project directory exists
        if (!fs.existsSync(projectDir)) {
          fs.mkdirSync(projectDir, { recursive: true });
        }

        localPath = path.join(projectDir, name);
        if (fs.existsSync(localPath)) {
          return {
            success: false,
            error: `Directory ${localPath} already exists`,
          };
        }

        // Create GitHub repository
        const repoInfo = await githubService.createRepository({
          name,
          description,
          owner,
          isPrivate,
        });
        githubRepoCreated = true;
        repoUrl = repoInfo.url;

        // Clone repository
        const cloneResult = await githubService.cloneRepository(repoUrl, localPath);
        if (!cloneResult.success) {
          // Cleanup: delete GitHub repo on clone failure
          try {
            // Security: Use quoteShellArg to prevent command injection
            const repoRef = `${quoteShellArg(owner)}/${quoteShellArg(name)}`;
            await execAsync(`gh repo delete ${repoRef} --yes`, {
              timeout: 10000,
            });
          } catch (cleanupError) {
            log.warn('Failed to cleanup GitHub repo after clone failure:', cleanupError);
          }
          return {
            success: false,
            error: cloneResult.error || 'Failed to clone repository',
          };
        }
        localDirCreated = true;

        // Initialize project (create README, commit, push)
        await githubService.initializeNewProject({
          repoUrl,
          localPath,
          name,
          description,
        });

        // TODO: Add .gitignore if template specified (for future enhancement)

        return {
          success: true,
          projectPath: localPath,
          repoUrl,
          fullName: repoInfo.fullName,
          defaultBranch: repoInfo.defaultBranch,
        };
      } catch (error) {
        log.error('Failed to create new project:', error);

        // Cleanup on failure
        if (localDirCreated && localPath && fs.existsSync(localPath)) {
          try {
            fs.rmSync(localPath, { recursive: true, force: true });
          } catch (cleanupError) {
            log.warn('Failed to cleanup local directory:', cleanupError);
          }
        }

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create project',
          githubRepoCreated, // Inform frontend about orphaned repo
          repoUrl,
        };
      }
    }
  );
}
