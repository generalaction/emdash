import { app, BrowserWindow, dialog } from 'electron';
import { join } from 'node:path';
import dockIcon from '../assets/images/emdash/icon-dock.png?asset';
import dotenv from 'dotenv';
import { createMainWindow } from './_new/window';
import { registerAppScheme, setupAppProtocol } from './_new/protocol';
import { setupApplicationMenu } from './_new/menu';
import { registerAllIpc } from './_new/ipc';
import { taskResourceManager } from './_new/environment/task-resource-manager';
import { initializeDatabase } from './_new/db/initialize';
import { autoUpdateService } from './_new/services/AutoUpdateService';
import { worktreePoolService } from './services/WorktreePoolService';
import { ptyPoolService } from './services/PtyPoolService';
import { sshService } from './services/ssh/SshService';
import { taskLifecycleService } from './services/TaskLifecycleService';
import { agentEventService } from './services/AgentEventService';
import * as telemetry from './_new/telemetry';
import { errorTracking } from './errorTracking';
import { log } from './_new/lib/logger';
import { localDependencyManager } from './_new/services/LocalDependencyManager';

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

  registerAllIpc();

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
  // Stop agent event HTTP server
  agentEventService.stop();
  // Stop any lifecycle run scripts so they do not outlive the app process.
  taskLifecycleService.shutdown();

  // Cleanup reserve worktrees (fire and forget - don't block quit)
  worktreePoolService.cleanup().catch(() => {});
  // Kill all pre-warmed pool PTYs
  ptyPoolService.cleanup();

  // Tear down all active task environments (closes SSH channels, cleans PTY sessions)
  taskResourceManager.teardownAll().catch(() => {});

  // Disconnect all SSH connections to avoid orphaned sessions on remote hosts
  sshService.disconnectAll().catch(() => {});
});
