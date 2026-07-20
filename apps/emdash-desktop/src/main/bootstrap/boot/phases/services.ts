import { app } from 'electron';
import { promptLibraryService } from '@core/features/library/node/prompt-library-service';
import { installAutomationTelemetry } from '@core/features/telemetry/node/automation-telemetry';
import { appSettingsContributions } from '@core/manifests/shared/settings-contributions';
import { initializeNotificationService } from '@core/services/notifications/node';
import { pullRequestsRegistration } from '@core/services/pull-requests/node/pull-requests-registration';
import { appSettingsService, configureAppSettingsService } from '@core/services/settings/node';
import { createSshService } from '@core/services/ssh/node';
import { sshCredentialService } from '@core/services/ssh/node/credentials/ssh-credential-service';
import { appService } from '@main/core/app/service';
import { automationsService } from '@main/core/automations/automations-service';
import { startLifecycleReconciler } from '@main/core/operations/lifecycle-reconciler';
import { operationsService } from '@main/core/operations/operations-service';
import { projectSettingsService } from '@main/core/projects/settings/project-settings-service';
import { db } from '@main/db/client';
import { setBrowserCorsRelaxationSettings } from '@main/host/browser/browser-profile-session';
import { browserWebContentsRegistry } from '@main/host/browser/browser-webcontents-registry';
import { installUpdateNotifications } from '@main/host/updates/update-notifications';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { appScope } from '../../core/app-scope';
import type { Phase } from '../../core/phase';
import type { BootContext } from '../types';
import { registerProviderTokenHandlers, wireAccountTelemetry } from '../wiring';

export const configureServicesPhase: Phase<BootContext> = {
  name: 'configure-services',
  run() {
    installAutomationTelemetry();
    configureAppSettingsService(appSettingsContributions);
  },
};

export const servicesPhase: Phase<BootContext> = {
  name: 'services',
  async run(context) {
    try {
      await telemetryService.initialize({
        appVersion: app.getVersion(),
        isPackaged: app.isPackaged,
        installSource: app.isPackaged ? 'dmg' : 'dev',
      });
    } catch (error) {
      log.warn('telemetry init failed:', error);
    }

    wireAccountTelemetry();
    projectSettingsService.initialize();
    pullRequestsRegistration.initialize();
    appService.initialize();
    await appSettingsService.initialize();
    await automationsService.initialize();
    await initializeNotificationService();
    installUpdateNotifications();
    context.ssh = createSshService({
      scope: appScope,
      db,
      credentials: sshCredentialService,
      logger: log,
      telemetry: telemetryService,
    });
    browserWebContentsRegistry.setKeyboardSettings(await appSettingsService.get('keyboard'));
    setBrowserCorsRelaxationSettings(await appSettingsService.get('browser'));
    await promptLibraryService.initialize();
    await operationsService.initialize();
    startLifecycleReconciler(operationsService);
    registerProviderTokenHandlers();
  },
};
