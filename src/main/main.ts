// Load .env FIRST before any imports that might use it
// Use explicit path to ensure .env is loaded from project root
try {
  const path = require('path');
  const envPath = path.join(__dirname, '..', '..', '.env');
  require('dotenv').config({ path: envPath });
} catch (error) {
  // dotenv is optional - no error if .env doesn't exist
}

import { app, BrowserWindow, dialog } from 'electron';
import { initializeShellEnvironment } from './utils/shellEnv';
// Ensure PATH matches the user's shell when launched from Finder (macOS)
// so Homebrew/NPM global binaries like `gh` and `codex` are found.
try {
  // Lazy import to avoid bundler complaints if not present on other platforms
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fixPath = require('fix-path');
  if (typeof fixPath === 'function') fixPath();
} catch {
  // no-op if fix-path isn't available at runtime
}

if (process.platform === 'darwin') {
  const extras = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/homebrew/sbin', '/usr/local/sbin'];
  const cur = process.env.PATH || '';
  const parts = cur.split(':').filter(Boolean);
  for (const p of extras) {
    if (!parts.includes(p)) parts.unshift(p);
  }
  process.env.PATH = parts.join(':');

  // As a last resort, ask the user's login shell for PATH and merge it in.
  try {
    const { execSync } = require('child_process');
    const shell = process.env.SHELL || '/bin/zsh';
    const loginPath = execSync(`${shell} -ilc 'echo -n $PATH'`, { encoding: 'utf8' });
    if (loginPath) {
      const merged = new Set((loginPath + ':' + process.env.PATH).split(':').filter(Boolean));
      process.env.PATH = Array.from(merged).join(':');
    }
  } catch {}
}

if (process.platform === 'linux') {
  try {
    const os = require('os');
    const path = require('path');
    const homeDir = os.homedir();
    const extras = [
      path.join(homeDir, '.nvm/versions/node', process.version, 'bin'),
      path.join(homeDir, '.npm-global/bin'),
      path.join(homeDir, '.local/bin'),
      '/usr/local/bin',
    ];
    const cur = process.env.PATH || '';
    const parts = cur.split(':').filter(Boolean);
    for (const p of extras) {
      if (!parts.includes(p)) parts.unshift(p);
    }
    process.env.PATH = parts.join(':');

    try {
      const { execSync } = require('child_process');
      const shell = process.env.SHELL || '/bin/bash';
      const loginPath = execSync(`${shell} -ilc 'echo -n $PATH'`, {
        encoding: 'utf8',
      });
      if (loginPath) {
        const merged = new Set((loginPath + ':' + process.env.PATH).split(':').filter(Boolean));
        process.env.PATH = Array.from(merged).join(':');
      }
    } catch {}
  } catch {}
}

// Enable automatic Wayland/X11 detection on Linux.
// Uses native Wayland when available, falls back to X11 (XWayland) otherwise.
// Must be called before app.whenReady().
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

if (process.platform === 'win32') {
  // Ensure npm global binaries are in PATH for Windows
  const npmPath = require('path').join(process.env.APPDATA || '', 'npm');
  const cur = process.env.PATH || '';
  const parts = cur.split(';').filter(Boolean);
  if (npmPath && !parts.includes(npmPath)) {
    parts.unshift(npmPath);
    process.env.PATH = parts.join(';');
  }
}

// Detect SSH_AUTH_SOCK from user's shell environment
// This is necessary because GUI-launched apps don't inherit shell env vars
try {
  initializeShellEnvironment();
} catch (error) {
  // Silent fail - SSH agent auth will fail if user tries to use it
  console.log('[main] Failed to initialize shell environment:', error);
}

import { createMainWindow } from './app/window';
import { registerAppLifecycle } from './app/lifecycle';
import { setupApplicationMenu } from './app/menu';
import { registerAllIpc } from './ipc';
import { databaseService, DatabaseSchemaMismatchError } from './services/DatabaseService';
import { connectionsService } from './services/ConnectionsService';
import { autoUpdateService } from './services/AutoUpdateService';
import { worktreePoolService } from './services/WorktreePoolService';
import { sshService } from './services/ssh/SshService';
import { taskLifecycleService } from './services/TaskLifecycleService';
import { agentEventService } from './services/AgentEventService';
import * as telemetry from './telemetry';
import { errorTracking } from './errorTracking';
import { join } from 'path';
import { rmSync } from 'node:fs';

// Set app name for macOS dock and menu bar
app.setName('Emdash');

// Prevent multiple instances in production (e.g. user clicks icon while auto-updater is restarting).
// Skip in dev so dev server can run alongside the packaged app.
const isDev = !app.isPackaged || process.argv.includes('--dev');
if (!isDev) {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    // Must also exit the process; app.quit() alone still runs the rest of this module
    // before the event loop drains, which would register unnecessary listeners and timers.
    process.exit(0);
  }
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// Set dock icon on macOS in development mode
if (process.platform === 'darwin' && !app.isPackaged) {
  const iconPath = join(
    __dirname,
    '..',
    '..',
    '..',
    'src',
    'assets',
    'images',
    'emdash',
    'icon-dock.png'
  );
  try {
    app.dock.setIcon(iconPath);
  } catch (err) {
    console.warn('Failed to set dock icon:', err);
  }
}

// App bootstrap
app.whenReady().then(async () => {
  const resetLocalDatabase = async (dbPath: string) => {
    await databaseService.close().catch(() => {});
    for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      rmSync(filePath, { force: true });
    }
  };

  // Initialize database
  let dbInitOk = false;
  let dbInitErrorType: string | undefined;
  try {
    await databaseService.initialize();
    dbInitOk = true;
  } catch (error) {
    const err = error as unknown;
    const asObj = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : null;
    const code = asObj && typeof asObj.code === 'string' ? asObj.code : undefined;
    const name = asObj && typeof asObj.name === 'string' ? asObj.name : undefined;
    dbInitErrorType = code || name || 'unknown';
    console.error('Failed to initialize database:', error);

    if (err instanceof DatabaseSchemaMismatchError) {
      const missing = err.missingInvariants.map((item) => `• ${item}`).join('\n');
      const result = await dialog.showMessageBox({
        type: 'error',
        title: 'Local Data Reset Required',
        message: 'Emdash cannot start because your local database schema is incompatible.',
        detail: [
          'Required schema entries are missing:',
          missing || '• unknown invariant',
          '',
          `Database path: ${err.dbPath}`,
          '',
          'Choose "Reset Local Data and Relaunch" to delete local Emdash data and start fresh.',
          'This only removes local app data (projects, tasks, conversations). Repository files are not deleted.',
        ].join('\n'),
        buttons: ['Reset Local Data and Relaunch', 'Quit'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });

      if (result.response === 0) {
        try {
          await resetLocalDatabase(err.dbPath);
          app.relaunch();
          app.exit(0);
          return;
        } catch (resetError) {
          console.error('Failed to reset local database:', resetError);
          dialog.showErrorBox(
            'Database Reset Failed',
            `Unable to delete local database at:\n${err.dbPath}\n\n${resetError instanceof Error ? resetError.message : String(resetError)}`
          );
        }
      }

      app.quit();
      return;
    }

    if (err instanceof Error && err.message.includes('migrations folder')) {
      dialog.showErrorBox(
        'Database Initialization Failed',
        'Unable to initialize the application database.\n\n' +
          'This may be due to:\n' +
          '• Running from Downloads or DMG (move to Applications)\n' +
          '• Homebrew installation issues (try direct download)\n' +
          '• Incomplete installation\n\n' +
          'Please try:\n' +
          '1. Move Emdash to Applications folder\n' +
          '2. Download directly from GitHub releases\n' +
          '3. Check console for detailed error information'
      );
    }
  }

  // Initialize telemetry (privacy-first, with optional GitHub username)
  await telemetry.init({ installSource: app.isPackaged ? 'dmg' : 'dev' });

  // Initialize error tracking
  await errorTracking.init();

  try {
    const summary = databaseService.getLastMigrationSummary();
    const toBucket = (n: number) => (n === 0 ? '0' : n === 1 ? '1' : n <= 3 ? '2-3' : '>3');
    telemetry.capture('db_setup', {
      outcome: dbInitOk ? 'success' : 'failure',
      ...(dbInitOk
        ? {
            applied_migrations: summary?.appliedCount ?? 0,
            applied_migrations_bucket: toBucket(summary?.appliedCount ?? 0),
            recovered: summary?.recovered === true,
          }
        : {
            error_type: dbInitErrorType ?? 'unknown',
          }),
    });
  } catch {
    // telemetry must never crash the app
  }

  // Best-effort: capture a coarse snapshot of project/task counts (no names/paths)
  let localProjectPathsForReserveCleanup: string[] = [];
  try {
    const [projects, tasks] = await Promise.all([
      databaseService.getProjects(),
      databaseService.getTasks(),
    ]);
    localProjectPathsForReserveCleanup = projects
      .filter((project) => !project.isRemote)
      .map((project) => project.path);
    const projectCount = projects.length;
    const taskCount = tasks.length;
    const toBucket = (n: number) =>
      n === 0 ? '0' : n <= 2 ? '1-2' : n <= 5 ? '3-5' : n <= 10 ? '6-10' : '>10';
    telemetry.capture('task_snapshot', {
      project_count: projectCount,
      project_count_bucket: toBucket(projectCount),
      task_count: taskCount,
      task_count_bucket: toBucket(taskCount),
    } as any);
  } catch {
    // ignore errors — telemetry is best-effort only
  }

  // Start agent event HTTP server (receives hook callbacks from CLI agents)
  try {
    await agentEventService.start();
  } catch (error) {
    console.warn('Failed to start agent event service:', error);
  }

  // Register IPC handlers
  registerAllIpc();

  // Clean up any orphaned reserve worktrees from previous sessions
  worktreePoolService.cleanupOrphanedReserves(localProjectPathsForReserveCleanup).catch((error) => {
    console.warn('Failed to cleanup orphaned reserves:', error);
  });

  // Warm provider installation cache
  try {
    await connectionsService.initProviderStatusCache();
  } catch {
    // best-effort; ignore failures
  }

  // Set up native application menu (Settings, Edit, View, Window)
  setupApplicationMenu();

  // Create main window
  createMainWindow();

  // Initialize auto-update service after window is created
  try {
    await autoUpdateService.initialize();
  } catch (error) {
    if (app.isPackaged) {
      console.error('Failed to initialize auto-update service:', error);
    }
  }
});

// App lifecycle handlers
registerAppLifecycle();

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

  // Disconnect all SSH connections to avoid orphaned sessions on remote hosts
  sshService.disconnectAll().catch(() => {});
});
