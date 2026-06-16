import './app/configure-app-identity';
import { join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import dockIcon from '@/assets/images/emdash/icon-dock.png?asset';
import { PRODUCT_NAME } from '@shared/app-identity';
import { githubAccountsChangedChannel } from '@shared/events/githubEvents';
import { registerRPCRouter } from '@shared/lib/ipc/rpc';
import { setupApplicationMenu } from './app/menu';
import { registerAppScheme, setupAppProtocol } from './app/protocol';
import { createMainWindow } from './app/window';
import { providerTokenRegistry } from './core/account/provider-token-registry';
import { emdashAccountService } from './core/account/services/emdash-account-service';
import { agentHookService } from './core/agent-hooks/agent-hook-service';
import { appService } from './core/app/service';
import { automationsService } from './core/automations/automations-service';
import { browserWebContentsRegistry } from './core/browser/browser-webcontents-registry';
import { localDependencyManager } from './core/dependencies/dependency-managers';
import { editorBufferService } from './core/editor/editor-buffer-service';
import { githubAccountReconciliationService } from './core/github/accounts/github-account-reconciliation-instance';
import { githubAccountRegistry } from './core/github/accounts/github-account-registry-instance';
import { GitHubAuthServerAdapter } from './core/github/accounts/github-auth-server-adapter';
import { projectManager } from './core/projects/project-manager';
import { projectSettingsService } from './core/projects/settings/project-settings-service';
import { promptLibraryService } from './core/prompt-library/service';
import { prSyncScheduler } from './core/pull-requests/pr-sync-scheduler';
import {
  reconcileResourceSampler,
  stopResourceSampler,
} from './core/resource-monitor/resource-sampler';
import { searchService } from './core/search/search-service';
import { workspaceFileIndexService } from './core/search/workspace-file-index-service';
import { appSettingsService } from './core/settings/settings-service';
import { updateService } from './core/updates/update-service';
import { viewStateService } from './core/view-state/view-state-service';
import { initializeDatabase } from './db/initialize';
import { events } from './lib/events';
import {
  initializeFileLogger,
  registerProcessErrorLogging,
  registerRendererLogHandler,
} from './lib/file-logger';
import { log } from './lib/logger';
import { telemetryService } from './lib/telemetry';
import { rpcRouter } from './rpc';
import { resolveUserEnv } from './utils/userEnv';

if (import.meta.env.DEV) {
  dotenvConfig({ path: '.env.local', override: false });
}

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

registerAppScheme();

initializeFileLogger();
registerProcessErrorLogging(log);
registerRendererLogHandler(ipcMain);

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win?.isMinimized()) win.restore();
  win?.focus();
});

if (!import.meta.env.DEV && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

if (import.meta.env.DEV) {
  try {
    app.dock?.setIcon(dockIcon);
  } catch (err) {
    log.warn('Failed to set dock icon:', err);
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

void app.whenReady().then(async () => {
  await resolveUserEnv();

  try {
    await initializeDatabase();
    searchService.initialize();
    workspaceFileIndexService.initialize();
    void editorBufferService.pruneStale();
    try {
      viewStateService.pruneOrphans();
    } catch (e: unknown) {
      log.warn('view-state: failed to prune orphaned entries', { error: e });
    }
  } catch (error) {
    log.error('Failed to initialize database:', error);
    dialog.showErrorBox(
      'Database Initialization Failed',
      `${PRODUCT_NAME} could not start because the database failed to initialize.\n\n${error instanceof Error ? error.message : String(error)}`
    );
    app.quit();
    return;
  }

  try {
    await telemetryService.initialize({ installSource: app.isPackaged ? 'dmg' : 'dev' });
  } catch (e) {
    log.warn('telemetry init failed:', e);
  }

  emdashAccountService.on('accountChanged', (username, userId, email) => {
    void telemetryService.identify(username, userId, email);
  });
  emdashAccountService.on('accountCleared', () => {
    telemetryService.clearIdentity();
  });

  projectSettingsService.initialize();
  prSyncScheduler.initialize();
  automationsService.start();
  appService.initialize();
  await appSettingsService.initialize();
  browserWebContentsRegistry.setKeyboardSettings(await appSettingsService.get('keyboard'));
  await promptLibraryService.initialize();

  agentHookService.initialize().catch((e) => {
    log.error('Failed to start agent event service:', e);
  });

  emdashAccountService.loadSessionToken().catch((e) => {
    log.warn('Failed to load account session token:', e);
  });

  const githubAuthServerAdapter = new GitHubAuthServerAdapter(githubAccountRegistry);
  providerTokenRegistry.register('github', (payload) =>
    githubAuthServerAdapter.storeOAuthToken(payload)
  );

  registerRPCRouter(rpcRouter, ipcMain);

  void reconcileResourceSampler();

  localDependencyManager.probeAll().catch((e) => {
    log.error('Failed to probe dependencies:', e);
  });

  setupAppProtocol(join(app.getAppPath(), 'out', 'renderer'));
  setupApplicationMenu();
  createMainWindow();

  githubAccountReconciliationService
    .reconcileAtStartup()
    .then(() => {
      events.emit(githubAccountsChangedChannel, { reason: 'startup-reconciliation' });
    })
    .catch((e) => {
      log.warn('Failed to reconcile GitHub accounts at startup:', e);
    });

  try {
    await updateService.initialize();
  } catch (error) {
    if (app.isPackaged) {
      log.error('Failed to initialize auto-update service:', error);
    }
  }
});

app.on('before-quit', (event) => {
  event.preventDefault();
  telemetryService.capture('app_closed');
  void telemetryService.dispose().finally(() => {
    automationsService.stop();
    agentHookService.dispose();
    stopResourceSampler();
    updateService.dispose();
    prSyncScheduler.dispose();
    void projectManager.dispose().catch((e) => {
      log.error('Failed to shutdown project manager:', e);
    });
    app.exit(0);
  });
});
