import { homedir } from 'node:os';
import * as path from 'node:path';
import type {
  GitHubAuthResponse,
  GitHubConnectResponse,
  GitHubStatusResponse,
} from '@shared/github';
import { createRPCController } from '@shared/ipc/rpc';
import { ACCOUNT_CONFIG } from '@main/core/account/config';
import { GitHubAuthExecutionContext } from '@main/core/execution-context/github-auth-execution-context';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { cloneRepository, initializeNewProject } from '@main/core/git/impl/git-repo-utils';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import { repoService } from '@main/core/github/services/repo-service';
import { sshConnectionManager } from '@main/core/ssh/ssh-connection-manager';
import { log } from '@main/lib/logger';
import { capture, identify as telemetryIdentify } from '@main/lib/telemetry';

export const githubController = createRPCController({
  getStatus: async (): Promise<GitHubStatusResponse> => {
    try {
      return await githubConnectionService.getStatus();
    } catch (error) {
      log.error('GitHub status check failed:', error);
      return { authenticated: false, user: null, tokenSource: null };
    }
  },

  auth: async (): Promise<GitHubAuthResponse> => {
    try {
      const result = await githubConnectionService.startDeviceFlowAuth();
      if (result.success) {
        capture('integration_connected', { provider: 'github' });
        const user = await githubConnectionService.getCurrentUser();
        if (user?.login) {
          telemetryIdentify(user.login);
        }
      }
      return result;
    } catch (error) {
      log.error('GitHub authentication failed:', error);
      return { success: false, error: 'Authentication failed' };
    }
  },

  connectOAuth: async (): Promise<GitHubConnectResponse> => {
    try {
      const { baseUrl } = ACCOUNT_CONFIG.authServer;
      const result = await githubConnectionService.startOAuthFlow(baseUrl);
      if (result.success) {
        capture('integration_connected', { provider: 'github' });
        if (result.user?.login) {
          telemetryIdentify(result.user.login);
        } else {
          const user = await githubConnectionService.getCurrentUser();
          if (user?.login) {
            telemetryIdentify(user.login);
          }
        }
      }
      return result;
    } catch (error) {
      log.error('GitHub OAuth connect failed:', error);
      return { success: false, error: 'OAuth connection failed' };
    }
  },

  authCancel: async () => {
    try {
      githubConnectionService.cancelAuth();
      return { success: true };
    } catch (error) {
      log.error('Failed to cancel GitHub auth:', error);
      return { success: false, error: 'Failed to cancel' };
    }
  },

  isAuthenticated: async () => {
    try {
      return await githubConnectionService.isAuthenticated();
    } catch (error) {
      log.error('GitHub authentication check failed:', error);
      return false;
    }
  },

  logout: async () => {
    try {
      await githubConnectionService.logout();
      capture('integration_disconnected', { provider: 'github' });
      return { success: true };
    } catch (error) {
      log.error('GitHub logout failed:', error);
      return { success: false, error: 'Logout failed' };
    }
  },

  getUser: async () => {
    try {
      return await githubConnectionService.getCurrentUser();
    } catch (error) {
      log.error('Failed to get user info:', error);
      return null;
    }
  },

  storeToken: async (token: string) => {
    try {
      await githubConnectionService.storeToken(token);
      return { success: true };
    } catch (error) {
      log.error('Failed to store token:', error);
      return { success: false, error: 'Failed to store token' };
    }
  },

  // -- Repositories --------------------------------------------------------

  getRepositories: async () => {
    try {
      return await repoService.listRepositories();
    } catch (error) {
      log.error('Failed to get repositories:', error);
      return [];
    }
  },

  getOwners: async () => {
    try {
      const owners = await repoService.getOwners();
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
      const isPrivate = params.isPrivate ?? params.visibility === 'private';
      const repoInfo = await repoService.createRepository({
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
    try {
      await repoService.deleteRepository(owner, name);
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
      const formatValidation = repoService.validateRepositoryName(name);
      if (!formatValidation.valid) {
        return {
          success: true,
          valid: false,
          exists: false,
          error: formatValidation.error,
        };
      }

      if (owner) {
        const exists = await repoService.checkRepositoryExists(owner, name);
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
    try {
      const exists = await repoService.checkRepositoryExists(owner, name);
      return { success: true, exists };
    } catch (error) {
      log.error('Failed to check repository existence:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check repository',
      };
    }
  },

  cloneRepository: async (repoUrl: string, targetPath: string, connectionId?: string) => {
    try {
      let ctx;
      let parentFs: FileSystemProvider;

      if (connectionId) {
        const proxy = await sshConnectionManager.connect(connectionId);
        ctx = new GitHubAuthExecutionContext(
          new SshExecutionContext(proxy, { root: path.posix.dirname(targetPath) }),
          () => githubConnectionService.getToken()
        );
        parentFs = new SshFileSystem(proxy, path.posix.dirname(targetPath));
      } else {
        ctx = new GitHubAuthExecutionContext(
          new LocalExecutionContext({ root: path.dirname(targetPath) }),
          () => githubConnectionService.getToken()
        );
        parentFs = new LocalFileSystem(path.dirname(targetPath));
      }

      await parentFs.mkdir('.', { recursive: true });
      return await cloneRepository(repoUrl, targetPath, ctx);
    } catch (error) {
      log.error('Failed to clone repository:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Clone failed',
      };
    }
  },

  initializeProject: async (params: {
    targetPath: string;
    name: string;
    description?: string;
    connectionId?: string;
  }) => {
    try {
      let ctx;
      let projectFs: FileSystemProvider;

      if (params.connectionId) {
        const proxy = await sshConnectionManager.connect(params.connectionId);
        ctx = new GitHubAuthExecutionContext(
          new SshExecutionContext(proxy, { root: params.targetPath }),
          () => githubConnectionService.getToken()
        );
        projectFs = new SshFileSystem(proxy, params.targetPath);
      } else {
        ctx = new GitHubAuthExecutionContext(
          new LocalExecutionContext({ root: params.targetPath }),
          () => githubConnectionService.getToken()
        );
        projectFs = new LocalFileSystem(params.targetPath);
      }

      await initializeNewProject(
        {
          repoUrl: '',
          localPath: params.targetPath,
          name: params.name,
          description: params.description,
        },
        ctx,
        projectFs
      );

      return { success: true };
    } catch (error) {
      log.error('Failed to initialize project:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Initialize failed',
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

    let repoUrl: string | undefined;
    let nameWithOwner: string | undefined;
    let defaultBranch: string | undefined;
    let githubRepoCreated = false;

    try {
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
      const cloneCtx = new GitHubAuthExecutionContext(
        new LocalExecutionContext({ root: path.dirname(localPath) }),
        () => githubConnectionService.getToken()
      );
      const parentFs = new LocalFileSystem(path.dirname(localPath));
      await parentFs.mkdir('.', { recursive: true });
      const cloneResult = await cloneRepository(cloneUrl, localPath, cloneCtx);
      if (!cloneResult.success) {
        throw new Error(cloneResult.error ?? 'Clone failed');
      }

      const initCtx = new GitHubAuthExecutionContext(
        new LocalExecutionContext({ root: localPath }),
        () => githubConnectionService.getToken()
      );
      const projectFs = new LocalFileSystem(localPath);
      await initializeNewProject(
        { repoUrl: cloneUrl, localPath, name, description },
        initCtx,
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
});
