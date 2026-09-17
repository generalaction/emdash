import { Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { githubEvents } from '@core/features/github/node';
import type { GitHubDeviceFlowService } from '@core/features/github/node/services/github-device-flow-service';
import type { GitHubRepositoryService } from '@core/features/github/node/services/repo-service';
import type {
  GitHubAuthResponse,
  GitHubImportCliAccountsResponse,
} from '@core/primitives/github/api';
import type { GitHubCliAccountImportService } from './accounts/github-cli-account-import';

export function createGithubOperations(dependencies: {
  cliAccountImporter: Pick<GitHubCliAccountImportService, 'importAccounts'>;
  deviceFlowService: GitHubDeviceFlowService;
  logger: Logger;
  repositoryService: GitHubRepositoryService;
}) {
  const {
    cliAccountImporter,
    deviceFlowService: githubDeviceFlowService,
    logger,
    repositoryService: repoService,
  } = dependencies;
  return {
    auth: async (): Promise<GitHubAuthResponse> => {
      let result: Awaited<ReturnType<typeof githubDeviceFlowService.start>>;
      try {
        result = await githubDeviceFlowService.start();
      } catch (error) {
        logger.error('GitHub authentication failed', { error });
        githubEvents.emit(undefined, {
          type: 'auth-error',
          error: 'device_flow_error',
          message: 'Authentication failed',
        });
        return { success: false, error: 'Authentication failed' };
      }

      if (!result.success) return result;

      githubEvents.emit(undefined, { type: 'auth-success', user: result.user });
      return { success: true, account: result.account };
    },

    importCliAccounts: (): Promise<GitHubImportCliAccountsResponse> =>
      Result.tryAsync<GitHubImportCliAccountsResponse>(async () => {
        const imported = await cliAccountImporter.importAccounts();
        const importedAccountIds = [...new Set(imported.map((account) => account.accountId))];
        return { success: true, importedAccountIds };
      }).unwrapOrElse((error) => {
        logger.error('Failed to import GitHub CLI accounts', { error });
        return { success: false, error: 'Failed to import GitHub CLI accounts' };
      }),

    authCancel: (): Promise<{ success: true } | { success: false; error: string }> =>
      Result.tryAsync<{ success: true } | { success: false; error: string }>(async () => {
        githubDeviceFlowService.cancel();
        return { success: true };
      }).unwrapOrElse((error) => {
        logger.error('Failed to cancel GitHub auth', { error });
        return { success: false, error: 'Failed to cancel' };
      }),

    // -- Repositories --------------------------------------------------------

    getRepositories: (accountId?: string) =>
      Result.tryAsync(() => repoService.listRepositories({ accountId })).unwrapOrElse((error) => {
        logger.error('Failed to get repositories', { error });
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
        logger.error('Failed to get owners', { error });
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
        logger.error('Failed to create repository', { error });
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
        logger.error('Failed to delete repository', { error });
        return { success: false, error: error.message ?? 'Failed to delete repository' };
      }),
  };
}
