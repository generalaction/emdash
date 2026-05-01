import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import dockIcon from '@/assets/images/emdash/icon-dock.png?asset';
import { PRODUCT_NAME } from '@shared/app-identity';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { STARTER_PROMPT_TEMPLATES } from '@shared/prompt-templates';
import { setupApplicationMenu } from './app/menu';
import { registerAppScheme, setupAppProtocol } from './app/protocol';
import { createMainWindow } from './app/window';
import { providerTokenRegistry } from './core/account/provider-token-registry';
import { emdashAccountService } from './core/account/services/emdash-account-service';
import { agentHookService } from './core/agent-hooks/agent-hook-service';
import { appService } from './core/app/service';
import { localDependencyManager } from './core/dependencies/dependency-manager';
import { editorBufferService } from './core/editor/editor-buffer-service';
import { gitWatcherRegistry } from './core/git/git-watcher-registry';
import { githubConnectionService } from './core/github/services/github-connection-service';
import { projectManager } from './core/projects/project-manager';
import { PromptTemplateService } from './core/prompt-templates/service';
import { prSyncScheduler } from './core/pull-requests/pr-sync-scheduler';
import { appSettingsService } from './core/settings/settings-service';
import { updateService } from './core/updates/update-service';
import { db } from './db/client';
import { initializeDatabase } from './db/initialize';
import { log } from './lib/logger';
import * as telemetry from './lib/telemetry';
import { rpcRouter } from './rpc';
import { resolveUserEnv } from './utils/userEnv';

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

async function migrateReviewPromptToTemplates(): Promise<void> {
  const service = new PromptTemplateService(db);
  const existing = await service.list();
  if (existing.length > 0) return;

  // Migrate old reviewPrompt if it exists and is non-empty
  let migrated = false;
  try {
    const reviewPrompt = await appSettingsService.get('reviewPrompt');
    const text = (reviewPrompt ?? '').trim();
    if (text) {
      await service.create({ name: 'Review prompt', text });
      migrated = true;
    }
  } catch {
    // If reviewPrompt setting doesn't exist or fails, skip silently
  }

  // If nothing was migrated, seed the default starter templates
  if (!migrated) {
    for (const template of STARTER_PROMPT_TEMPLATES) {
      await service.create(template);
    }
  }
}

registerAppScheme();

app.setName(PRODUCT_NAME);
app.setPath('userData', join(app.getPath('appData'), 'emdash'));

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
    void editorBufferService.pruneStale();
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

  gitWatcherRegistry.initialize();
  prSyncScheduler.initialize();
  appService.initialize();
  await appSettingsService.initialize();
  await migrateReviewPromptToTemplates();

  agentHookService.initialize().catch((e) => {
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

  agentHookService.dispose();
  updateService.dispose();
  prSyncScheduler.dispose();
  void gitWatcherRegistry.dispose();
  projectManager.dispose().catch((e) => {
    log.error('Failed to shutdown project manager:', e);
  });
});
