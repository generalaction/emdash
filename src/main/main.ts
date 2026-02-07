// Load .env FIRST before any imports that might use it
// Use explicit path to ensure .env is loaded from project root
try {
  const path = require('path');
  const envPath = path.join(__dirname, '..', '..', '.env');
  require('dotenv').config({ path: envPath });
} catch (error) {
  // dotenv is optional - no error if .env doesn't exist
}

import { app, BrowserWindow } from 'electron';
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
import { createMainWindow } from './app/window';
import { registerAppLifecycle } from './app/lifecycle';
import { registerAllIpc } from './ipc';
import { databaseService } from './services/DatabaseService';
import { connectionsService } from './services/ConnectionsService';
import { autoUpdateService } from './services/AutoUpdateService';
import { worktreePoolService } from './services/WorktreePoolService';
import * as telemetry from './telemetry';
import { errorTracking } from './errorTracking';
import { join } from 'path';

// Set app name for macOS dock and menu bar
app.setName('Emdash');

// Prevent multiple instances (e.g. user clicks icon while auto-updater is restarting)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  // Must also exit the process; app.quit() alone still runs the rest of this module
  // before the event loop drains, which would register unnecessary listeners and timers.
  process.exit(0);
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

    if (err instanceof Error && err.message.includes('migrations folder')) {
      const { dialog } = require('electron');
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
  try {
    const [projects, tasks] = await Promise.all([
      databaseService.getProjects(),
      databaseService.getTasks(),
    ]);
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

  // Register IPC handlers
  registerAllIpc();

  // Clean up any orphaned reserve worktrees from previous sessions
  worktreePoolService.cleanupOrphanedReserves().catch((error) => {
    console.warn('Failed to cleanup orphaned reserves:', error);
  });

  // Warm provider installation cache
  try {
    await connectionsService.initProviderStatusCache();
  } catch {
    // best-effort; ignore failures
  }

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

  // Cleanup reserve worktrees (fire and forget - don't block quit)
  worktreePoolService.cleanup().catch(() => {});
});
