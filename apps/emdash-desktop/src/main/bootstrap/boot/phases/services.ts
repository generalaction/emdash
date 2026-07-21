import { resolve } from 'node:path';
import { app } from 'electron';
import type { AccountKVSchema } from '@core/features/account/node/services/account-session-store';
import { createEmdashAccountService } from '@core/features/account/node/services/emdash-account-service';
import {
  createPromptLibraryService,
  type PromptLibraryKV,
} from '@core/features/library/node/prompt-library-service';
import { installAutomationTelemetry } from '@core/features/telemetry/node/automation-telemetry';
import { appSettingsContributions } from '@core/manifests/shared/settings-contributions';
import { AppDbKeyValueStore } from '@core/services/app-db/node/key-value-store';
import { createNotificationService } from '@core/services/notifications/node';
import { createOperationsEngine } from '@core/services/operations/node';
import { pullRequestsRegistration } from '@core/services/pull-requests/node/pull-requests-registration';
import { createAppSettingsService } from '@core/services/settings/node';
import { createProviderOverrideSettings } from '@core/services/settings/node/provider-settings-service';
import { createSshService } from '@core/services/ssh/node';
import { sshCredentialService } from '@core/services/ssh/node/credentials/ssh-credential-service';
import {
  createR2WorkspaceServerArtifactSource,
  createRemoteFileWorkspaceServerArtifactSource,
  createWorkspaceServerService,
} from '@core/services/workspace-server/node';
import { appService } from '@main/core/app/service';
import { automationsService } from '@main/core/automations/automations-service';
import { setOperationsEngine } from '@main/core/operations/operations-engine-instance';
import { createDeleteProjectOperationDefinition } from '@main/core/projects/operations/delete-project-definition';
import { projectSettingsService } from '@main/core/projects/settings/project-settings-service';
import { createCleanupSessionsOperationDefinition } from '@main/core/runtime/operations/cleanup-sessions-definition';
import { createDeleteTaskOperationDefinition } from '@main/core/tasks/operations/delete-task-definition';
import {
  createArchiveWorkspaceOperationDefinition,
  createDeleteWorkspaceOperationDefinition,
} from '@main/core/workspaces/operations/workspace-lifecycle-definitions';
import { setBrowserCorsRelaxationSettings } from '@main/host/browser/browser-profile-session';
import { browserWebContentsRegistry } from '@main/host/browser/browser-webcontents-registry';
import { installUpdateNotifications } from '@main/host/updates/update-notifications';
import { isAppFocused } from '@main/host/window';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { appScope } from '../../core/app-scope';
import type { Phase } from '../../core/phase';
import { setCoreServiceInstances } from '../../core/service-instances';
import type { BootContext } from '../types';
import { registerProviderTokenHandlers, wireAccountTelemetry } from '../wiring';

export const configureServicesPhase: Phase<BootContext> = {
  name: 'configure-services',
  run() {
    installAutomationTelemetry();
  },
};

export const servicesPhase: Phase<BootContext> = {
  name: 'services',
  async run(context) {
    const db = context.db;
    if (!db) throw new Error('App database was not initialized before the services phase');

    const appSettingsService = createAppSettingsService({
      db,
      contributions: appSettingsContributions,
    });
    const providerOverrideSettings = createProviderOverrideSettings(db);
    const accountService = createEmdashAccountService({
      keyValueStore: new AppDbKeyValueStore<AccountKVSchema>(db, 'account', log),
    });
    const promptLibraryService = createPromptLibraryService({
      db,
      keyValueStore: new AppDbKeyValueStore<PromptLibraryKV>(db, 'prompt-library', log),
    });
    const notificationService = createNotificationService({
      db,
      settings: appSettingsService,
      isAppFocused,
      logger: log,
    });
    setCoreServiceInstances({
      account: accountService,
      appSettings: appSettingsService,
      notifications: notificationService,
      promptLibrary: promptLibraryService,
      providerSettings: providerOverrideSettings,
    });
    context.accountService = accountService;
    context.appSettingsService = appSettingsService;
    context.notificationService = notificationService;
    context.promptLibraryService = promptLibraryService;
    context.providerOverrideSettings = providerOverrideSettings;

    try {
      await telemetryService.initialize({
        appVersion: app.getVersion(),
        isPackaged: app.isPackaged,
        installSource: app.isPackaged ? 'dmg' : 'dev',
      });
    } catch (error) {
      log.warn('telemetry init failed:', error);
    }

    wireAccountTelemetry(accountService);
    projectSettingsService.initialize();
    pullRequestsRegistration.initialize();
    appService.initialize();
    await appSettingsService.initialize();
    await automationsService.initialize();
    await notificationService.initialize();
    installUpdateNotifications(notificationService);
    context.ssh = createSshService({
      scope: appScope,
      db,
      credentials: sshCredentialService,
      logger: log,
      telemetry: telemetryService,
    });
    const artifactUrlOverride = process.env['EMDASH_WORKSPACE_SERVER_ARTIFACTS_URL'];
    const artifacts =
      app.isPackaged || artifactUrlOverride
        ? createR2WorkspaceServerArtifactSource(artifactUrlOverride)
        : createRemoteFileWorkspaceServerArtifactSource({
            localDirectory: resolve(app.getAppPath(), '../workspace-server/dist-artifacts'),
            remoteDirectory:
              process.env['EMDASH_WORKSPACE_SERVER_REMOTE_ARTIFACTS_DIR'] ??
              '/opt/emdash-artifacts',
          });
    context.workspaceServer = createWorkspaceServerService({
      scope: appScope,
      ssh: context.ssh,
      artifacts,
      logger: log,
    });
    browserWebContentsRegistry.setKeyboardSettings(await appSettingsService.get('keyboard'));
    setBrowserCorsRelaxationSettings(await appSettingsService.get('browser'));
    await promptLibraryService.initialize();
    const operations = await createOperationsEngine({
      scope: appScope,
      db,
      sshManager: context.ssh.manager,
      notifications: {
        publishPendingCleanup({ operationId, payload, hostRef, reason }) {
          notificationService.publish({
            kind: 'pending-cleanup',
            groupKey: `pending-cleanup:${hostRef}`,
            dedupeKey: `pending-cleanup:${operationId}:${reason}`,
            title: 'Pending cleanup needs review',
            body: `${payload.entityName ?? 'A workspace'} is waiting for cleanup review.`,
            sound: 'needs_attention',
            target: { kind: 'none' },
            source: { kind: 'app' },
          });
        },
      },
      definitions: [
        createDeleteTaskOperationDefinition(),
        createDeleteWorkspaceOperationDefinition(),
        createArchiveWorkspaceOperationDefinition(),
        createDeleteProjectOperationDefinition(),
        createCleanupSessionsOperationDefinition(),
      ],
    });
    setOperationsEngine(operations);
    registerProviderTokenHandlers();
  },
};
