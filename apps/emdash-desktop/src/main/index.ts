import './app/configure-app-identity';
import './core/telemetry/automation-telemetry';
import './core/telemetry/task-telemetry';
import { join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { app, BrowserWindow, dialog, ipcMain, systemPreferences } from 'electron';
import devIcon from '@/assets/images/emdash/emdash-dev.png?asset';
import { PRODUCT_NAME } from '@shared/app-identity';
import { githubAccountsChangedChannel } from '@shared/events/githubEvents';
import { registerRPCRouter } from '@shared/lib/ipc/rpc';
import { LIBSECRET_PASSWORD_STORE, shouldForceLibsecretBackend } from './app/linux-secret-storage';
import { setupApplicationMenu } from './app/menu';
import { registerAppScheme, setupAppProtocol } from './app/protocol';
import { registerQuitHandler } from './app/shutdown';
import { applyNativeTheme, createMainWindow } from './app/window';
import { providerTokenRegistry } from './core/account/provider-token-registry';
import { emdashAccountService } from './core/account/services/emdash-account-service';
import { acpAgentStatusBridge } from './core/acp/agent-status-bridge';
import { initializeAcpRuntimeProcess } from './core/acp/controller';
import { initializeAgentConfigRuntimeProcess } from './core/agent-config/controller';
import { agentHookService } from './core/agent-hooks/agent-hook-service';
import { appService } from './core/app/service';
import { automationsService } from './core/automations/automations-service';
import { cleanupLegacyBrowserPartitions } from './core/browser/browser-partition-cleanup';
import { setBrowserCorsRelaxationSettings } from './core/browser/browser-profile-session';
import { browserWebContentsRegistry } from './core/browser/browser-webcontents-registry';
import { resetStaleAcpAgentStatuses } from './core/conversations/reset-stale-acp-agent-statuses';
import { localDependencyManager } from './core/dependencies/dependency-managers';
import { editorBufferService } from './core/editor/editor-buffer-service';
import { lastTurnBaselineService } from './core/git/last-turn-baseline-service';
import { githubAccountReconciliationService } from './core/github/accounts/github-account-reconciliation-instance';
import { GitHubAuthServerAdapter } from './core/github/accounts/github-auth-server-adapter';
import { projectSettingsService } from './core/projects/settings/project-settings-service';
import { promptLibraryService } from './core/prompt-library/service';
import { providerAccountRegistry } from './core/provider-accounts/provider-account-registry-instance';
import { remoteTmuxReaperService } from './core/pty/remote-tmux-reaper-service';
import { prSyncScheduler } from './core/pull-requests/pr-sync-scheduler';
import { reconcileResourceSampler } from './core/resource-monitor/resource-sampler';
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
import { withRpcLogging } from './lib/rpc-logging';
import { telemetryService } from './lib/telemetry';
import { rpcRouter } from './rpc';
import { resolveUserEnv } from './utils/userEnv';

if (import.meta.env.DEV) {
  dotenvConfig({ path: '.env.local', override: false });
}

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  if (
    shouldForceLibsecretBackend(process.env, {
      passwordStoreSwitchPresent: app.commandLine.hasSwitch('password-store'),
    })
  ) {
    app.commandLine.appendSwitch('password-store', LIBSECRET_PASSWORD_STORE);
  }
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
    app.dock?.setIcon(devIcon);
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
    await resetStaleAcpAgentStatuses();
    searchService.initialize();
    workspaceFileIndexService.initialize();
    void editorBufferService.pruneStale();
    void cleanupLegacyBrowserPartitions();
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
  remoteTmuxReaperService.initialize();
  lastTurnBaselineService.initialize();
  automationsService.start();
  appService.initialize();
  await appSettingsService.initialize();
  applyNativeTheme(await appSettingsService.get('theme'));
  browserWebContentsRegistry.setKeyboardSettings(await appSettingsService.get('keyboard'));
  setBrowserCorsRelaxationSettings(await appSettingsService.get('browser'));
  await promptLibraryService.initialize();

  agentHookService.initialize().catch((e) => {
    log.error('Failed to start agent event service:', e);
  });
  initializeAcpRuntimeProcess().catch((e) => {
    log.error('Failed to start ACP runtime process:', e);
  });
  initializeAgentConfigRuntimeProcess().catch((e) => {
    log.error('Failed to start agent-config runtime process:', e);
  });
  acpAgentStatusBridge.initialize();

  emdashAccountService
    .initialize()
    .then((result) => {
      if (!result.success) {
        log.warn('Failed to load account session token:', result.error);
      }
    })
    .catch((e: unknown) => {
      log.warn('Account session initialization threw unexpectedly:', e);
    });

  const githubAuthServerAdapter = new GitHubAuthServerAdapter(providerAccountRegistry);
  providerTokenRegistry.register('github', (payload) =>
    githubAuthServerAdapter.storeOAuthToken(payload)
  );

  registerRPCRouter(rpcRouter, app.isPackaged ? ipcMain : withRpcLogging(ipcMain));

  void reconcileResourceSampler();

  localDependencyManager.probeAll().catch((e: unknown) => {
    log.error('Failed to probe dependencies:', e);
  });

  if (process.platform === 'darwin') {
    if (systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
      systemPreferences
        .askForMediaAccess('microphone')
        .then((granted) => {
          log.info('Microphone access request resolved:', { granted });
        })
        .catch((e) => {
          log.warn('Failed to request microphone access:', e);
        });
    }
  }

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

registerQuitHandler();
