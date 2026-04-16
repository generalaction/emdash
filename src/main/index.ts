import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import dockIcon from '@/assets/images/emdash/icon-dock.png?asset';
import { PRODUCT_NAME } from '@shared/app-identity';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { setupApplicationMenu } from './app/menu';
import { registerAppScheme, setupAppProtocol } from './app/protocol';
import { createMainWindow } from './app/window';
import { providerTokenRegistry } from './core/account/provider-token-registry';
import { emdashAccountService } from './core/account/services/emdash-account-service';
import { agentHookService } from './core/agent-hooks/agent-hook-service';
import { appService } from './core/app/service';
import { localDependencyManager } from './core/dependencies/dependency-manager';
import { editorBufferService } from './core/editor/editor-buffer-service';
import { githubConnectionService } from './core/github/services/github-connection-service';
import { projectManager } from './core/projects/project-manager';
import { prService } from './core/pull-requests/pr-service';
import { appSettingsService } from './core/settings/settings-service';
import { onPrUpserted } from './core/task-status/pr-task-bridge';
import { updateService } from './core/updates/update-service';
import { initializeDatabase } from './db/initialize';
import { log } from './lib/logger';
import * as telemetry from './lib/telemetry';
import { rpcRouter } from './rpc';
import { resolveUserEnv } from './utils/userEnv';

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

registerAppScheme();

app.setName(PRODUCT_NAME);

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

app.whenReady().then(async () => {
  await resolveUserEnv();

  try {
    await initializeDatabase();
    prService.registerUpsertHook(onPrUpserted);
    const BUFFER_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    editorBufferService.pruneStale(BUFFER_STALE_MS).catch((e) => {
      log.warn('Failed to prune stale editor buffers:', e);
    });
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
    await telemetry.init({ installSource: app.isPackaged ? 'dmg' : 'dev' });
  } catch (e) {
    log.warn('telemetry init failed:', e);
  }

  appService.initialize();
  appSettingsService.initialize();

  agentHookService.start().catch((e) => {
    log.error('Failed to start agent event service:', e);
  });

  emdashAccountService.loadSessionToken().catch((e) => {
    log.warn('Failed to load account session token:', e);
  });

  providerTokenRegistry.register('github', (token) => githubConnectionService.storeToken(token));

  registerRPCRouter(rpcRouter, ipcMain);

  localDependencyManager.probeAll().catch((e) => {
    log.error('Failed to probe dependencies:', e);
  });

  setupAppProtocol(join(app.getAppPath(), 'out', 'renderer'));
  setupApplicationMenu();
  createMainWindow();

  try {
    await updateService.initialize();
  } catch (error) {
    if (app.isPackaged) {
      log.error('Failed to initialize auto-update service:', error);
    }
  }
});

app.on('before-quit', () => {
  telemetry.capture('app_closed');
  telemetry.shutdown();

  agentHookService.stop();
  updateService.shutdown();
  projectManager.shutdown().catch((e) => {
    log.error('Failed to shutdown project manager:', e);
  });
});
