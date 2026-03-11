import { exec } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import { createRPCController } from '@shared/ipc/rpc';
import type { GitHubUser } from '@shared/types/github';
import { localDependencyManager } from '@main/core/dependencies/dependency-manager';
import { githubService } from '@main/core/github/GitHubService';
import { getAppSettings } from '@main/core/settings/settings';
import { log } from '@main/lib/logger';
import { quoteShellArg } from '@main/utils/shellEscape';

const execAsync = promisify(exec);

export const githubController = createRPCController({
  connect: async (projectPath: string) => {
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
  },

  auth: async () => {
    try {
      return await githubService.startDeviceFlowAuth();
    } catch (error) {
      log.error('GitHub authentication failed:', error);
      return { success: false, error: 'Authentication failed' };
    }
  },

  authCancel: async () => {
    try {
      githubService.cancelAuth();
      return { success: true };
    } catch (error) {
      log.error('Failed to cancel GitHub auth:', error);
      return { success: false, error: 'Failed to cancel' };
    }
  },

  isAuthenticated: async () => {
    try {
      return await githubService.isAuthenticated();
    } catch (error) {
      log.error('GitHub authentication check failed:', error);
      return false;
    }
  },

  getStatus: async () => {
    try {
      let installed = true;
      try {
        await execAsync('gh --version');
      } catch {
        installed = false;
      }

      let authenticated = false;
      let user: GitHubUser | null = null;
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
      return { installed: false, authenticated: false, user: null };
    }
  },

  getUser: async () => {
    try {
      const token = await (githubService as any)['getStoredToken']();
      if (!token) return null;
      return await githubService.getUserInfo(token);
    } catch (error) {
      log.error('Failed to get user info:', error);
      return null;
    }
  },

  getRepositories: async () => {
    try {
      const token = await (githubService as any)['getStoredToken']();
      if (!token) throw new Error('Not authenticated');
      return await githubService.getRepositories(token);
    } catch (error) {
      log.error('Failed to get repositories:', error);
      return [];
    }
  },

  cloneRepository: async (repoUrl: string, localPath: string) => {
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
      const cacheKey = createHash('sha1').update(norm(repoUrl)).digest('hex');
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
  },

  logout: async () => {
    await githubService.logout();
  },

  issuesList: async (projectPath: string, limit?: number) => {
    if (!projectPath) return { success: false, error: 'Project path is required' };
    try {
      const issues = await githubService.listIssues(projectPath, limit ?? 50);
      return { success: true, issues };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to list issues';
      return { success: false, error: message };
    }
  },

  issuesSearch: async (projectPath: string, searchTerm: string, limit?: number) => {
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
  },

  issuesGet: async (projectPath: string, number: number) => {
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
  },

  listPullRequests: async (args: { projectPath: string }) => {
    const projectPath = args?.projectPath;
    if (!projectPath) {
      return { success: false, error: 'Project path is required' };
    }

    try {
      const prs = await githubService.getPullRequests(projectPath);
      return { success: true, prs };
    } catch (error) {
      log.error('Failed to list pull requests:', error);
      const message =
        error instanceof Error ? error.message : 'Unable to list pull requests via GitHub CLI';
      return { success: false, error: message };
    }
  },

  checkCLIInstalled: async () => {
    try {
      const state = await localDependencyManager.probe('gh');
      return state.status === 'available';
    } catch (error) {
      log.error('Failed to check gh CLI installation:', error);
      return false;
    }
  },

  installCLI: async () => {
    const state = await localDependencyManager.install('gh');
    if (state.status !== 'available') {
      throw new Error(state.error ?? 'Installation failed');
    }
  },

  getOwners: async () => {
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
  },

  validateRepoName: async (name: string, owner: string) => {
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
  },

  createNewProject: async (params: {
    name: string;
    description?: string;
    owner: string;
    isPrivate: boolean;
    gitignoreTemplate?: string;
  }) => {
    let githubRepoCreated = false;
    let localDirCreated = false;
    let repoUrl: string | undefined;
    let localPath: string | undefined;

    try {
      const { name, description, owner, isPrivate } = params;

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
  },

  createRepository: async ({
    name,
    owner,
    visibility,
  }: {
    name: string;
    owner: string;
    visibility: 'public' | 'private';
  }): Promise<{ repoUrl: string; fullName: string }> => {
    const repoInfo = await githubService.createRepository({
      name,
      owner,
      isPrivate: visibility === 'private',
    });
    return { repoUrl: repoInfo.url, fullName: repoInfo.fullName };
  },
});
