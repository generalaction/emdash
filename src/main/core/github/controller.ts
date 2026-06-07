import * as path from 'node:path';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { cloneRepository, initializeNewProject } from '@main/core/git/impl/git-repo-utils';
import { githubAccountService } from '@main/core/github/accounts/github-account-service-instance';
import { githubDeviceFlowService } from '@main/core/github/services/github-device-flow-service-instance';
import { repoService } from '@main/core/github/services/repo-service';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { githubAuthErrorChannel, githubAuthSuccessChannel } from '@shared/events/githubEvents';
import type {
  GitHubAccountState,
  GitHubAccountSummary,
  GitHubAuthResponse,
  GitHubImportCliAccountsResponse,
  GitHubRemoveAccountResponse,
  GitHubSetDefaultAccountResponse,
} from '@shared/github';
import { createRPCController } from '@shared/lib/ipc/rpc';

export const githubController = createRPCController({
  getAccountState: async (): Promise<GitHubAccountState> => {
    try {
      const accounts = await githubAccountService.listAccounts();
      return {
        connected: accounts.length > 0,
        accounts,
        defaultAccountId: accounts.find((account) => account.isDefault)?.accountId ?? null,
      };
    } catch (error) {
      log.error('Failed to get GitHub account state:', error);
      return { connected: false, accounts: [], defaultAccountId: null };
    }
  },

  auth: async (): Promise<GitHubAuthResponse> => {
    let result: Awaited<ReturnType<typeof githubDeviceFlowService.start>>;
    try {
      result = await githubDeviceFlowService.start();
    } catch (error) {
      log.error('GitHub authentication failed:', error);
      events.emit(githubAuthErrorChannel, {
        error: 'device_flow_error',
        message: 'Authentication failed',
      });
      return { success: false, error: 'Authentication failed' };
    }

    if (!result.success) return result;

    try {
      const accountSummary = (await githubAccountService.listAccounts()).find(
        (candidate) => candidate.accountId === result.account.id
      );
      if (!accountSummary) {
        const message = 'Failed to register GitHub account';
        events.emit(githubAuthErrorChannel, { error: 'account_registration_failed', message });
        return { success: false, error: message };
      }

      telemetryService.capture('integration_connected', { provider: 'github' });
      events.emit(githubAuthSuccessChannel, { token: result.token, user: result.user });
      return { success: true, account: accountSummary };
    } catch (error) {
      log.error('Failed to register GitHub account after device flow:', error);
      const message = 'Failed to register GitHub account';
      events.emit(githubAuthErrorChannel, {
        error: 'account_registration_failed',
        message,
      });
      return { success: false, error: message };
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
      githubDeviceFlowService.cancel();
      return { success: true };
    } catch (error) {
      log.error('Failed to cancel GitHub auth:', error);
      return { success: false, error: 'Failed to cancel' };
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
        cloneUrl: repoInfo.cloneUrl,
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
