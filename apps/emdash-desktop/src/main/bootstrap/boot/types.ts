import type Database from 'better-sqlite3';
import type { EmdashAccountService } from '@core/features/account/node/services/emdash-account-service';
import type { AutomationsService } from '@core/features/automations/api/node/automations-service';
import type { EditorBufferService } from '@core/features/editor/node/editor-buffer-service';
import type { GitHubAccountReconciliationService } from '@core/features/github/node/accounts/github-account-reconciliation';
import type { GitHubAccountService } from '@core/features/github/node/accounts/github-account-service';
import type { GitHubDeviceFlowService } from '@core/features/github/node/services/github-device-flow-service';
import type { GitHubRepositoryService } from '@core/features/github/node/services/repo-service';
import type { IssueProviderRegistry } from '@core/features/issues/node/registry';
import type { PromptLibraryService } from '@core/features/library/node/prompt-library-service';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import type { ProjectSettingsService } from '@core/features/projects/api/node/settings/project-settings-service';
import type { SearchService } from '@core/features/search/node/search-service';
import type { TaskService } from '@core/features/tasks/api/node/task-service';
import type { TaskSessionManager } from '@core/features/tasks/api/node/task-session-manager';
import type { WorkspacePlacementResolver } from '@core/features/workspaces/api/node/placement/workspace-placement-resolver';
import type { WorkspaceBootstrapService } from '@core/features/workspaces/api/node/workspace-bootstrap-service';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import type { SshServiceHandle } from '@core/manifests/node/ssh-service-handle';
import type { AppDb } from '@core/services/app-db/node/db';
import type { NotificationService } from '@core/services/notifications/node';
import type { OperationsEngine } from '@core/services/operations/node';
import type { PullRequestsRegistration } from '@core/services/pull-requests/node/pull-requests-registration';
import type { AppSettingsService } from '@core/services/settings/node';
import type { ProviderOverrideSettings } from '@core/services/settings/node/provider-settings-service';
import type { WorkspaceServerServiceHandle } from '@core/services/workspace-server/node';
import type { AppConfig } from '../core/config';

export type BootContext = {
  readonly config: AppConfig;
  accountService: EmdashAccountService | undefined;
  automationsService: AutomationsService | undefined;
  appSettingsService: AppSettingsService | undefined;
  db: AppDb | undefined;
  editorBufferService: EditorBufferService | undefined;
  githubServices:
    | {
        account: GitHubAccountService;
        deviceFlow: GitHubDeviceFlowService;
        reconciliation: GitHubAccountReconciliationService;
        repositories: GitHubRepositoryService;
      }
    | undefined;
  notificationService: NotificationService | undefined;
  issueProviders: IssueProviderRegistry | undefined;
  operations: OperationsEngine | undefined;
  promptLibraryService: PromptLibraryService | undefined;
  pullRequestsRegistration: PullRequestsRegistration | undefined;
  projectManager: ProjectSessionManager | undefined;
  projectSettingsService: ProjectSettingsService | undefined;
  providerOverrideSettings: ProviderOverrideSettings | undefined;
  searchService: SearchService | undefined;
  taskService: TaskService | undefined;
  taskSessionManager: TaskSessionManager | undefined;
  sqlite: Database.Database | undefined;
  workspaceIdentity: WorkspaceIdentityService | undefined;
  workspaceBootstrapService: WorkspaceBootstrapService | undefined;
  workspacePlacement: WorkspacePlacementResolver | undefined;
  windowPhaseReady: boolean;
  ssh: SshServiceHandle | undefined;
  workspaceServer: WorkspaceServerServiceHandle | undefined;
};

export class BootAborted extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootAborted';
  }
}

export function isBootAborted(error: unknown): error is BootAborted {
  return error instanceof BootAborted;
}
