import type Database from 'better-sqlite3';
import type { EmdashAccountService } from '@core/features/account/node/services/emdash-account-service';
import type { EditorBufferService } from '@core/features/editor/node/editor-buffer-service';
import type { PromptLibraryService } from '@core/features/library/node/prompt-library-service';
import type { SearchService } from '@core/features/search/node/search-service';
import type { WorkspaceIdentityService } from '@core/features/workspaces/node/workspace-identity-service';
import type { AppDb } from '@core/services/app-db/node/db';
import type { NotificationService } from '@core/services/notifications/node';
import type { AppSettingsService } from '@core/services/settings/node';
import type { ProviderOverrideSettings } from '@core/services/settings/node/provider-settings-service';
import type { SshServiceHandle } from '@core/services/ssh/node';
import type { WorkspaceServerServiceHandle } from '@core/services/workspace-server/node';
import type { AppConfig } from '../core/config';

export type BootContext = {
  readonly config: AppConfig;
  accountService: EmdashAccountService | undefined;
  appSettingsService: AppSettingsService | undefined;
  db: AppDb | undefined;
  editorBufferService: EditorBufferService | undefined;
  notificationService: NotificationService | undefined;
  promptLibraryService: PromptLibraryService | undefined;
  providerOverrideSettings: ProviderOverrideSettings | undefined;
  searchService: SearchService | undefined;
  sqlite: Database.Database | undefined;
  workspaceIdentity: WorkspaceIdentityService | undefined;
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
