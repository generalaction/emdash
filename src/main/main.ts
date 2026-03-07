import dotenv from 'dotenv';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import dockIcon from '../assets/images/emdash/icon-dock.png?asset';
import { createMainWindow } from './_new/app/window';
import { registerAppScheme, setupAppProtocol } from './_new/app/protocol';
import { setupApplicationMenu } from './_new/app/menu';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { environmentProviderManager } from './_new/environment/provider-manager';
import { initializeDatabase } from './_new/db/initialize';
import { autoUpdateService } from './_new/services/AutoUpdateService';
import { sshService } from './_deprecated/services/ssh/SshService';
import * as telemetry from './_new/lib/telemetry';
import { errorTracking } from './_new/error-tracking';
import { log } from './_new/lib/logger';
import { localDependencyManager } from './_new/services/LocalDependencyManager';
import { rpcRouter } from './_new/ipc';

dotenv.config({ path: join(__dirname, '..', '..', '.env') });

// Enable automatic Wayland/X11 detection on Linux.
// Must be called before app.whenReady().
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

// Register the app:// scheme as a privileged secure origin.
// Must be called before app.whenReady().
registerAppScheme();

app.setName('Emdash');

// Raise and focus the existing window when a second instance is launched.
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win?.isMinimized()) win.restore();
  win?.focus();
});

// Enforce single instance in production; in dev both the packaged app and the
// dev server need to coexist, so the lock is skipped
if (!import.meta.env.DEV && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Set dock icon in development mode (production builds use the app bundle icon).
if (process.platform === 'darwin' && import.meta.env.DEV) {
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

// App bootstrap
app.whenReady().then(async () => {
  try {
    await initializeDatabase();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    dialog.showErrorBox(
      'Database Initialization Failed',
      `Emdash could not start because the database failed to initialize.\n\n${error instanceof Error ? error.message : String(error)}`
    );
    app.quit();
    return;
  }

  try {
    await telemetry.init({ installSource: app.isPackaged ? 'dmg' : 'dev' });
  } catch (e) {
    log.warn('telemetry init failed:', e);
  }
  try {
    await errorTracking.init();
  } catch (e) {
    log.warn('errorTracking init failed:', e);
  }

  registerRPCRouter(rpcRouter, ipcMain);

  // Initialize per-project environment providers and hydrate existing task sessions.
  environmentProviderManager.initialize().catch((e) => {
    log.error('Failed to initialize environment providers:', e);
  });

  void localDependencyManager.probeAll().catch((e) => {
    log.error('Failed to probe dependencies:', e);
  });

  setupAppProtocol(join(app.getAppPath(), 'out', 'renderer'));
  setupApplicationMenu();
  createMainWindow();

  // Initialize auto-update service after window is created
  try {
    await autoUpdateService.initialize();
  } catch (error) {
    if (app.isPackaged) {
      log.error('Failed to initialize auto-update service:', error);
    }
  }
});

// Graceful shutdown telemetry event
app.on('before-quit', () => {
  // Session summary with duration (no identifiers)
  telemetry.capture('app_session');
  telemetry.capture('app_closed');
  telemetry.shutdown();

  // Cleanup auto-update service
  autoUpdateService.shutdown();
  // Tear down all active task environments (closes SSH channels, cleans PTY sessions)
  environmentProviderManager.shutdown().catch(() => {});

  // Disconnect all SSH connections to avoid orphaned sessions on remote hosts
  sshService.disconnectAll().catch(() => {});
});
