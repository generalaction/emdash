import { providerTokenRegistry } from '@core/features/account/node/provider-token-registry';
import type { EmdashAccountService } from '@core/features/account/node/services/emdash-account-service';
import { provisionWorkspaceErrorToWorkspaceError } from '@core/features/workspaces/node/wire-controller';
import { GitHubAuthServerAdapter } from '@main/core/github/accounts/github-auth-server-adapter';
import { providerAccountRegistry } from '@main/core/provider-accounts/provider-account-registry-instance';
import { taskService } from '@main/core/tasks/task-service';
import { legacyPortOperations } from '@main/db/legacy-port/controller';
import type { InstallDesktopWireOptions } from '@main/gateway/desktop-wire';
import { telemetryService } from '@main/lib/telemetry';
import type { BootContext } from './types';

export function wireAccountTelemetry(accountService: EmdashAccountService): void {
  accountService.on('accountChanged', (username, userId, email) => {
    void telemetryService.identify(username, userId, email);
  });
  accountService.on('accountCleared', () => {
    telemetryService.clearIdentity();
  });
}

export function registerProviderTokenHandlers(): void {
  const githubAuthServerAdapter = new GitHubAuthServerAdapter(providerAccountRegistry);
  providerTokenRegistry.register('github', (payload) =>
    githubAuthServerAdapter.storeOAuthToken(payload)
  );
}

export function createDesktopWireOptions(context: BootContext): InstallDesktopWireOptions {
  return {
    accountService: requireBootService(context.accountService, 'account service'),
    appSettings: requireBootService(context.appSettingsService, 'app settings service'),
    db: requireBootService(context.db, 'app database'),
    editorBuffer: requireBootService(context.editorBufferService, 'editor buffer service'),
    legacyPortOperations,
    notifications: requireBootService(context.notificationService, 'notification service'),
    promptLibrary: requireBootService(context.promptLibraryService, 'prompt library service'),
    providerSettings: requireBootService(
      context.providerOverrideSettings,
      'provider settings service'
    ),
    search: requireBootService(context.searchService, 'search service'),
    workspaceIdentity: requireBootService(context.workspaceIdentity, 'workspace identity service'),
    workspaces: {
      async provisionTask(taskId) {
        const result = await taskService.provisionWorkspace(taskId);
        return result.success
          ? result
          : { success: false, error: provisionWorkspaceErrorToWorkspaceError(result.error) };
      },
      onTaskWorkspaceReady(handler) {
        return taskService.on('task:workspace-ready', (_taskId, result) =>
          handler(_taskId, result)
        );
      },
    },
  };
}

function requireBootService<T>(service: T | undefined, name: string): T {
  if (!service) throw new Error(`${name} was not initialized before the gateway phase`);
  return service;
}
