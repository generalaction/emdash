import { Result } from '@emdash/shared/result';
import { githubAccountService } from '@main/core/github/accounts/github-account-service-instance';
import { githubDeviceFlowService } from '@main/core/github/services/github-device-flow-service-instance';
import { repoService } from '@main/core/github/services/repo-service';
import { events } from '@main/host/events';
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
  getAccountState: async (): Promise<GitHubAccountState> =>
    Result.tryAsync(async () => {
      const accounts = await githubAccountService.listAccounts();
      return {
        connected: accounts.length > 0,
        accounts,
        defaultAccountId: accounts.find((account) => account.isDefault)?.accountId ?? null,
      };
    }).unwrapOrElse((error) => {
      log.error('Failed to get GitHub account state:', error);
      return { connected: false, accounts: [], defaultAccountId: null };
    }),

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
      events.emit(githubAuthSuccessChannel, { user: result.user });
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

  listAccounts: (): Promise<GitHubAccountSummary[]> =>
    Result.tryAsync(() => githubAccountService.listAccounts()).unwrapOrElse((error) => {
      log.error('Failed to list GitHub accounts:', error);
      return [];
    }),

  importCliAccounts: (): Promise<GitHubImportCliAccountsResponse> =>
    Result.tryAsync<GitHubImportCliAccountsResponse>(async () => {
      const result = await githubAccountService.importCliAccounts();
      if (result.importedAccountIds.length > 0) {
        telemetryService.capture('integration_connected', { provider: 'github', source: 'cli' });
      }
      return result;
    }).unwrapOrElse((error) => {
      log.error('Failed to import GitHub CLI accounts:', error);
      return { success: false, error: 'Failed to import GitHub CLI accounts' };
    }),

  setDefaultAccount: (accountId: string): Promise<GitHubSetDefaultAccountResponse> =>
    Result.tryAsync<GitHubSetDefaultAccountResponse>(async () => {
      const account = await githubAccountService.setDefaultAccount(accountId);
      if (!account) return { success: false, error: 'GitHub account not found' };
      return { success: true, account };
    }).unwrapOrElse((error) => {
      log.error('Failed to set default GitHub account:', error);
      return { success: false, error: 'Failed to set default GitHub account' };
    }),

  removeAccount: (accountId: string): Promise<GitHubRemoveAccountResponse> =>
    Result.tryAsync<GitHubRemoveAccountResponse>(async () => {
      const accounts = await githubAccountService.removeAccount(accountId);
      if (!accounts) return { success: false, error: 'GitHub account not found' };
      telemetryService.capture('integration_disconnected', { provider: 'github' });
      return { success: true, accounts };
    }).unwrapOrElse((error) => {
      log.error('Failed to remove GitHub account:', error);
      return { success: false, error: 'Failed to remove GitHub account' };
    }),

  authCancel: (): Promise<{ success: true } | { success: false; error: string }> =>
    Result.tryAsync<{ success: true } | { success: false; error: string }>(async () => {
      githubDeviceFlowService.cancel();
      return { success: true };
    }).unwrapOrElse((error) => {
      log.error('Failed to cancel GitHub auth:', error);
      return { success: false, error: 'Failed to cancel' };
    }),

  // -- Repositories --------------------------------------------------------

  getRepositories: (accountId?: string) =>
    Result.tryAsync(() => repoService.listRepositories({ accountId })).unwrapOrElse((error) => {
      log.error('Failed to get repositories:', error);
      return [];
    }),

  getOwners: (
    accountId?: string
  ): Promise<
    | { success: true; owners: Awaited<ReturnType<typeof repoService.getOwners>> }
    | { success: false; error: string }
  > =>
    Result.tryAsync<
      | { success: true; owners: Awaited<ReturnType<typeof repoService.getOwners>> }
      | { success: false; error: string }
    >(async () => {
      const owners = await repoService.getOwners({ accountId });
      return { success: true, owners };
    }).unwrapOrElse((error) => {
      log.error('Failed to get owners:', error);
      return { success: false, error: error.message ?? 'Failed to get owners' };
    }),

  createRepository: (params: {
    name: string;
    owner: string;
    description?: string;
    isPrivate?: boolean;
    visibility?: 'public' | 'private';
    accountId?: string | null;
  }): Promise<
    | {
        success: true;
        repoUrl: string;
        cloneUrl: string;
        nameWithOwner: string;
        defaultBranch: string;
      }
    | { success: false; error: string }
  > =>
    Result.tryAsync<
      | {
          success: true;
          repoUrl: string;
          cloneUrl: string;
          nameWithOwner: string;
          defaultBranch: string;
        }
      | { success: false; error: string }
    >(async () => {
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
    }).unwrapOrElse((error) => {
      log.error('Failed to create repository:', error);
      return { success: false, error: error.message ?? 'Failed to create repository' };
    }),

  deleteRepository: (params: {
    owner: string;
    name: string;
    accountId?: string | null;
  }): Promise<{ success: true } | { success: false; error: string }> =>
    Result.tryAsync<{ success: true } | { success: false; error: string }>(async () => {
      await repoService.deleteRepository(params.owner, params.name, {
        accountId: params.accountId ?? undefined,
      });
      return { success: true };
    }).unwrapOrElse((error) => {
      log.error('Failed to delete repository:', error);
      return { success: false, error: error.message ?? 'Failed to delete repository' };
    }),
});
