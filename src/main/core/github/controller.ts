import { homedir } from 'node:os';
import * as path from 'node:path';
import { Octokit } from '@octokit/rest';
import { createRPCController } from '@shared/ipc/rpc';
import { localDependencyManager } from '@main/core/dependencies/dependency-manager';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { cloneRepository, initializeNewProject } from '@main/core/git/impl/git-repo-utils';
import { githubAuthService } from '@main/core/github/services/github-auth-service';
import { GitHubIssueServiceImpl } from '@main/core/github/services/issue-service';
import { GitHubPullRequestServiceImpl } from '@main/core/github/services/pr-service';
import { GitHubRepositoryServiceImpl } from '@main/core/github/services/repo-service';
import { splitRepo } from '@main/core/github/services/utils';
import { getLocalExec } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';

async function getOctokit(): Promise<Octokit> {
  const token = await githubAuthService.getToken();
  if (!token) throw new Error('Not authenticated');
  return new Octokit({ auth: token });
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export const githubController = createRPCController({
  // -- Auth ----------------------------------------------------------------

  getStatus: async () => {
    try {
      const authenticated = await githubAuthService.isAuthenticated();
      let user = null;
      if (authenticated) {
        user = await githubAuthService.getCurrentUser();
      }
      return { installed: true, authenticated, user };
    } catch (error) {
      log.error('GitHub status check failed:', error);
      return { installed: true, authenticated: false, user: null };
    }
  },

  auth: async () => {
    try {
      return await githubAuthService.startDeviceFlowAuth();
    } catch (error) {
      log.error('GitHub authentication failed:', error);
      return { success: false, error: 'Authentication failed' };
    }
  },

  authOAuth: async () => {
    try {
      return await githubAuthService.startOAuthAuth();
    } catch (error) {
      log.error('GitHub OAuth authentication failed:', error);
      return { success: false, error: 'OAuth authentication failed' };
    }
  },

  authCancel: async () => {
    try {
      githubAuthService.cancelAuth();
      return { success: true };
    } catch (error) {
      log.error('Failed to cancel GitHub auth:', error);
      return { success: false, error: 'Failed to cancel' };
    }
  },

  isAuthenticated: async () => {
    try {
      return await githubAuthService.isAuthenticated();
    } catch (error) {
      log.error('GitHub authentication check failed:', error);
      return false;
    }
  },

  logout: async () => {
    try {
      await githubAuthService.logout();
      return { success: true };
    } catch (error) {
      log.error('GitHub logout failed:', error);
      return { success: false, error: 'Logout failed' };
    }
  },

  getUser: async () => {
    try {
      return await githubAuthService.getCurrentUser();
    } catch (error) {
      log.error('Failed to get user info:', error);
      return null;
    }
  },

  storeToken: async (token: string) => {
    try {
      await githubAuthService.storeToken(token);
      return { success: true };
    } catch (error) {
      log.error('Failed to store token:', error);
      return { success: false, error: 'Failed to store token' };
    }
  },

  // -- Issues ---------------------------------------------------------------

  issuesList: async (nameWithOwner: string, limit?: number) => {
    if (!nameWithOwner) return { success: false, error: 'Repository is required' };
    try {
      const octokit = await getOctokit();
      const service = new GitHubIssueServiceImpl(octokit);
      const issues = await service.listIssues(nameWithOwner, limit ?? 50);
      return { success: true, issues };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to list issues';
      return { success: false, error: message };
    }
  },

  issuesSearch: async (nameWithOwner: string, searchTerm: string, limit?: number) => {
    if (!nameWithOwner) return { success: false, error: 'Repository is required' };
    if (!searchTerm || typeof searchTerm !== 'string') {
      return { success: false, error: 'Search term is required' };
    }
    try {
      const octokit = await getOctokit();
      const service = new GitHubIssueServiceImpl(octokit);
      const issues = await service.searchIssues(nameWithOwner, searchTerm, limit ?? 20);
      return { success: true, issues };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to search issues';
      return { success: false, error: message };
    }
  },

  issuesGet: async (nameWithOwner: string, issueNumber: number) => {
    if (!nameWithOwner) return { success: false, error: 'Repository is required' };
    if (!issueNumber || !Number.isFinite(issueNumber)) {
      return { success: false, error: 'Issue number is required' };
    }
    try {
      const octokit = await getOctokit();
      const service = new GitHubIssueServiceImpl(octokit);
      const issue = await service.getIssue(nameWithOwner, issueNumber);
      return { success: !!issue, issue: issue ?? undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to get issue';
      return { success: false, error: message };
    }
  },

  // -- Pull Requests -------------------------------------------------------

  listPullRequests: async (
    nameWithOwner: string,
    options?: { limit?: number; searchQuery?: string }
  ) => {
    if (!nameWithOwner) {
      return { success: false, error: 'Repository is required' };
    }
    try {
      const octokit = await getOctokit();
      const service = new GitHubPullRequestServiceImpl(octokit);
      const result = await service.listPullRequests(nameWithOwner, options);
      return { success: true, prs: result.prs, totalCount: result.totalCount };
    } catch (error) {
      log.error('Failed to list pull requests:', error);
      const message = error instanceof Error ? error.message : 'Unable to list pull requests';
      return { success: false, error: message };
    }
  },

  getPullRequestDetails: async (nameWithOwner: string, prNumber: number) => {
    if (!nameWithOwner) return { success: false, error: 'Repository is required' };
    if (!prNumber || !Number.isFinite(prNumber)) {
      return { success: false, error: 'PR number is required' };
    }
    try {
      const octokit = await getOctokit();
      const service = new GitHubPullRequestServiceImpl(octokit);
      const pr = await service.getPullRequestDetails(nameWithOwner, prNumber);
      return { success: !!pr, pr: pr ?? undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to get pull request';
      return { success: false, error: message };
    }
  },

  createPullRequest: async (params: {
    nameWithOwner: string;
    head: string;
    base: string;
    title: string;
    draft: boolean;
  }) => {
    if (!params.nameWithOwner) return { success: false, error: 'Repository is required' };
    if (!params.head) return { success: false, error: 'Head branch is required' };
    if (!params.base) return { success: false, error: 'Base branch is required' };
    if (!params.title) return { success: false, error: 'Title is required' };
    try {
      const octokit = await getOctokit();
      const { owner, repo } = splitRepo(params.nameWithOwner);
      const response = await octokit.rest.pulls.create({
        owner,
        repo,
        head: params.head,
        base: params.base,
        title: params.title,
        draft: params.draft,
      });
      return { success: true, url: response.data.html_url, number: response.data.number };
    } catch (error) {
      log.error('Failed to create pull request:', error);
      const message = error instanceof Error ? error.message : 'Unable to create pull request';
      return { success: false, error: message };
    }
  },

  // -- Repositories --------------------------------------------------------

  getRepositories: async () => {
    try {
      const octokit = await getOctokit();
      const service = new GitHubRepositoryServiceImpl(octokit);
      return await service.listRepositories();
    } catch (error) {
      log.error('Failed to get repositories:', error);
      return [];
    }
  },

  getOwners: async () => {
    try {
      const octokit = await getOctokit();
      const service = new GitHubRepositoryServiceImpl(octokit);
      const owners = await service.getOwners();
      return { success: true, owners };
    } catch (error) {
      log.error('Failed to get owners:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get owners',
      };
    }
  },

  createRepository: async (params: {
    name: string;
    owner: string;
    description?: string;
    isPrivate?: boolean;
    visibility?: 'public' | 'private';
  }) => {
    try {
      const octokit = await getOctokit();
      const service = new GitHubRepositoryServiceImpl(octokit);
      const isPrivate = params.isPrivate ?? params.visibility === 'private';
      const repoInfo = await service.createRepository({
        name: params.name,
        owner: params.owner,
        description: params.description,
        isPrivate,
      });
      return {
        success: true,
        repoUrl: repoInfo.url,
        nameWithOwner: repoInfo.nameWithOwner,
        defaultBranch: repoInfo.defaultBranch,
      };
    } catch (error) {
      log.error('Failed to create repository:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create repository',
      };
    }
  },

  deleteRepository: async (owner: string, name: string) => {
    if (!owner || !name) return { success: false, error: 'Owner and name are required' };
    try {
      const octokit = await getOctokit();
      const service = new GitHubRepositoryServiceImpl(octokit);
      await service.deleteRepository(owner, name);
      return { success: true };
    } catch (error) {
      log.error('Failed to delete repository:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete repository',
      };
    }
  },

  validateRepoName: async (name: string, owner?: string) => {
    try {
      const octokit = await getOctokit();
      const service = new GitHubRepositoryServiceImpl(octokit);

      const formatValidation = service.validateRepositoryName(name);
      if (!formatValidation.valid) {
        return {
          success: true,
          valid: false,
          exists: false,
          error: formatValidation.error,
        };
      }

      if (owner) {
        const exists = await service.checkRepositoryExists(owner, name);
        if (exists) {
          return {
            success: true,
            valid: true,
            exists: true,
            error: `Repository ${owner}/${name} already exists`,
          };
        }
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

  checkRepositoryExists: async (owner: string, name: string) => {
    if (!owner || !name) return { success: false, error: 'Owner and name are required' };
    try {
      const octokit = await getOctokit();
      const service = new GitHubRepositoryServiceImpl(octokit);
      const exists = await service.checkRepositoryExists(owner, name);
      return { success: true, exists };
    } catch (error) {
      log.error('Failed to check repository existence:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check repository',
      };
    }
  },

  // -- Project creation orchestration ---------------------------------------

  cloneRepository: async (repoUrl: string, localPath: string) => {
    if (!repoUrl || !localPath) {
      return { success: false, error: 'Repository URL and local path are required' };
    }
    try {
      const exec = getLocalExec();
      const fs = new LocalFileSystem(path.dirname(localPath));
      return await cloneRepository(repoUrl, localPath, exec, fs);
    } catch (error) {
      log.error('Failed to clone repository:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Clone failed',
      };
    }
  },

  createNewProject: async (params: {
    name: string;
    owner: string;
    isPrivate: boolean;
    description?: string;
  }) => {
    const { name, owner, isPrivate, description } = params;
    if (!name || !owner) {
      return { success: false, error: 'Name and owner are required' };
    }

    let repoUrl: string | undefined;
    let nameWithOwner: string | undefined;
    let defaultBranch: string | undefined;
    let githubRepoCreated = false;

    try {
      const octokit = await getOctokit();
      const repoService = new GitHubRepositoryServiceImpl(octokit);
      const repoInfo = await repoService.createRepository({ name, owner, isPrivate, description });
      repoUrl = repoInfo.url;
      nameWithOwner = repoInfo.nameWithOwner;
      defaultBranch = repoInfo.defaultBranch;
      githubRepoCreated = true;

      const cloneUrl = `https://github.com/${nameWithOwner}.git`;
      const settings = {};
      const projectDir =
        (settings as { projects?: { defaultDirectory?: string } }).projects?.defaultDirectory ??
        path.join(homedir(), 'emdash-projects');
      const localPath = path.join(projectDir, name);
      const exec = getLocalExec();
      const fs = new LocalFileSystem(path.dirname(localPath));
      const cloneResult = await cloneRepository(cloneUrl, localPath, exec, fs);
      if (!cloneResult.success) {
        throw new Error(cloneResult.error ?? 'Clone failed');
      }

      const projectFs = new LocalFileSystem(localPath);
      await initializeNewProject(
        { repoUrl: cloneUrl, localPath, name, description },
        exec,
        projectFs
      );

      return {
        success: true,
        projectPath: localPath,
        repoUrl,
        nameWithOwner,
        defaultBranch,
        githubRepoCreated,
      };
    } catch (error) {
      log.error('Failed to create new project:', error);

      if (githubRepoCreated && nameWithOwner) {
        try {
          const octokit = await getOctokit();
          const repoService = new GitHubRepositoryServiceImpl(octokit);
          const [repoOwner, repoName] = nameWithOwner.split('/');
          await repoService.deleteRepository(repoOwner, repoName);
        } catch (cleanupError) {
          log.error('Failed to clean up GitHub repo after project creation failure:', cleanupError);
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create project',
        repoUrl,
        githubRepoCreated,
      };
    }
  },

  // -- CLI utilities (kept for gh CLI availability checks) -----------------

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
    try {
      const state = await localDependencyManager.install('gh');
      if (state.status !== 'available') {
        throw new Error(state.error ?? 'Installation failed');
      }
      return { success: true };
    } catch (error) {
      log.error('Failed to install gh CLI:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Installation failed',
      };
    }
  },
});
