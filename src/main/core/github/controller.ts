import * as path from 'node:path';
import { ACCOUNT_CONFIG } from '@main/core/account/config';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { cloneRepository, initializeNewProject } from '@main/core/git/impl/git-repo-utils';
import { githubAccountBackfillService } from '@main/core/github/accounts/github-account-backfill-instance';
import { githubAccountService } from '@main/core/github/accounts/github-account-service-instance';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import { repoService } from '@main/core/github/services/repo-service';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import type {
  GitHubAccountSummary,
  GitHubAuthResponse,
  GitHubConnectResponse,
  GitHubImportCliAccountsResponse,
  GitHubRemoveAccountResponse,
  GitHubSetDefaultAccountResponse,
  GitHubStatusOptions,
  GitHubStatusResponse,
} from '@shared/github';
import { createRPCController } from '@shared/ipc/rpc';

export const githubController = createRPCController({
  getStatus: async (options?: GitHubStatusOptions): Promise<GitHubStatusResponse> => {
    try {
      return await githubConnectionService.getStatus(options);
    } catch (error) {
      log.error('GitHub status check failed:', error);
      return { authenticated: false, user: null, tokenSource: null };
    }
  },

  auth: async (): Promise<GitHubAuthResponse> => {
    try {
      const result = await githubConnectionService.startDeviceFlowAuth();
      if (result.success) {
        await githubAccountBackfillService.backfillLegacyToken();
        telemetryService.capture('integration_connected', { provider: 'github' });
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
        await githubAccountBackfillService.backfillLegacyToken();
        telemetryService.capture('integration_connected', { provider: 'github' });
      }
      return result;
    } catch (error) {
      log.error('GitHub OAuth connect failed:', error);
      return { success: false, error: 'OAuth connection failed' };
    }
  },

  listAccounts: async (): Promise<GitHubAccountSummary[]> => {
    try {
      return await githubAccountService.listAccounts();
    } catch (error) {
      log.error('Failed to list GitHub accounts:', error);
      return [];
    }
  },

  importCliAccounts: async (): Promise<GitHubImportCliAccountsResponse> => {
    try {
      const result = await githubAccountService.importCliAccounts();
      if (result.importedAccountIds.length > 0) {
        telemetryService.capture('integration_connected', { provider: 'github', source: 'cli' });
      }
      return result;
    } catch (error) {
      log.error('Failed to import GitHub CLI accounts:', error);
      return { success: false, error: 'Failed to import GitHub CLI accounts' };
    }
  },

  setDefaultAccount: async (accountId: string): Promise<GitHubSetDefaultAccountResponse> => {
    try {
      const account = await githubAccountService.setDefaultAccount(accountId);
      if (!account) return { success: false, error: 'GitHub account not found' };
      return { success: true, account };
    } catch (error) {
      log.error('Failed to set default GitHub account:', error);
      return { success: false, error: 'Failed to set default GitHub account' };
    }
  },

  removeAccount: async (accountId: string): Promise<GitHubRemoveAccountResponse> => {
    try {
      const accounts = await githubAccountService.removeAccount(accountId);
      if (!accounts) return { success: false, error: 'GitHub account not found' };
      telemetryService.capture('integration_disconnected', { provider: 'github' });
      return { success: true, accounts };
    } catch (error) {
      log.error('Failed to remove GitHub account:', error);
      return { success: false, error: 'Failed to remove GitHub account' };
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
      telemetryService.capture('integration_disconnected', { provider: 'github' });
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

  getRepositories: async (accountId?: string) => {
    try {
      return await repoService.listRepositories({ accountId });
    } catch (error) {
      log.error('Failed to get repositories:', error);
      return [];
    }
  },

  getOwners: async (accountId?: string) => {
    try {
      const owners = await repoService.getOwners({ accountId });
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
    accountId?: string | null;
  }) => {
    try {
      const isPrivate = params.isPrivate ?? params.visibility === 'private';
      const repoInfo = await repoService.createRepository({
        name: params.name,
        owner: params.owner,
        description: params.description,
        isPrivate,
        authContext: { accountId: params.accountId ?? undefined },
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

  deleteRepository: async (params: { owner: string; name: string; accountId?: string | null }) => {
    try {
      await repoService.deleteRepository(params.owner, params.name, {
        accountId: params.accountId ?? undefined,
      });
      return { success: true };
    } catch (error) {
      log.error('Failed to delete repository:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete repository',
      };
    }
  },

  cloneRepository: async (repoUrl: string, targetPath: string, connectionId?: string) => {
    try {
      let ctx;
      let parentFs: FileSystemProvider;

      if (connectionId) {
        const proxy = await sshConnectionManager.connect(connectionId);
        ctx = new SshExecutionContext(proxy, { root: path.posix.dirname(targetPath) });
        parentFs = new SshFileSystem(proxy, path.posix.dirname(targetPath));
      } else {
        ctx = new LocalExecutionContext({ root: path.dirname(targetPath) });
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
        ctx = new SshExecutionContext(proxy, { root: params.targetPath });
        projectFs = new SshFileSystem(proxy, params.targetPath);
      } else {
        ctx = new LocalExecutionContext({ root: params.targetPath });
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
});
