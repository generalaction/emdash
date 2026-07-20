import { providerTokenRegistry } from '@core/features/account/node/provider-token-registry';
import { emdashAccountService } from '@core/features/account/node/services/emdash-account-service';
import { provisionWorkspaceErrorToWorkspaceError } from '@core/features/workspaces/node/wire-controller';
import { GitHubAuthServerAdapter } from '@main/core/github/accounts/github-auth-server-adapter';
import { providerAccountRegistry } from '@main/core/provider-accounts/provider-account-registry-instance';
import { taskService } from '@main/core/tasks/task-service';
import type { InstallDesktopWireOptions } from '@main/gateway/desktop-wire';
import { telemetryService } from '@main/lib/telemetry';

export function wireAccountTelemetry(): void {
  emdashAccountService.on('accountChanged', (username, userId, email) => {
    void telemetryService.identify(username, userId, email);
  });
  emdashAccountService.on('accountCleared', () => {
    telemetryService.clearIdentity();
  });
}

export function registerProviderTokenHandlers(): void {
  const githubAuthServerAdapter = new GitHubAuthServerAdapter(providerAccountRegistry);
  providerTokenRegistry.register('github', (payload) =>
    githubAuthServerAdapter.storeOAuthToken(payload)
  );
}

export function createDesktopWireOptions(): InstallDesktopWireOptions {
  return {
    async provisionTask(taskId) {
      const result = await taskService.provisionWorkspace(taskId);
      return result.success
        ? result
        : { success: false, error: provisionWorkspaceErrorToWorkspaceError(result.error) };
    },
    onTaskWorkspaceReady(handler) {
      return taskService.on('task:workspace-ready', (_taskId, result) => handler(_taskId, result));
    },
  };
}
