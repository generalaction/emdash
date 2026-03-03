import { ipcMain, BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const DEBOUNCE_MS = 300;
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 150;

const globalPlansDir = path.join(os.homedir(), '.claude', 'plans');

interface WatcherState {
  watcher: fs.FSWatcher | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  refCount: number;
}

let watcherState: WatcherState | null = null;

function broadcast(channel: string, payload: any) {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send(channel, payload);
      } catch {}
    }
  } catch {}
}

function isInsidePlansDir(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const resolvedPlansDir = path.resolve(globalPlansDir);
  return resolved.startsWith(resolvedPlansDir + path.sep) || resolved === resolvedPlansDir;
}

function startWatcher(): void {
  if (watcherState) {
    watcherState.refCount++;
    return;
  }

  watcherState = { watcher: null, pollTimer: null, debounceTimer: null, refCount: 1 };

  const attachFsWatch = () => {
    if (!watcherState) return;
    try {
      const watcher = fs.watch(globalPlansDir, (eventType, filename) => {
        if (!filename || !filename.endsWith('.md')) return;
        if (!watcherState) return;

        if (watcherState.debounceTimer) clearTimeout(watcherState.debounceTimer);
        watcherState.debounceTimer = setTimeout(() => {
          broadcast('plan:file-changed', { fileName: filename, eventType });
        }, DEBOUNCE_MS);
      });

      watcherState.watcher = watcher;
      if (watcherState.pollTimer) {
        clearInterval(watcherState.pollTimer);
        watcherState.pollTimer = null;
      }

      watcher.on('error', () => {
        stopWatcherInternal();
      });
    } catch {}
  };

  if (fs.existsSync(globalPlansDir)) {
    attachFsWatch();
  } else {
    let attempts = 0;
    watcherState.pollTimer = setInterval(() => {
      attempts++;
      if (attempts > MAX_POLL_ATTEMPTS) {
        if (watcherState?.pollTimer) {
          clearInterval(watcherState.pollTimer);
          watcherState.pollTimer = null;
        }
        return;
      }
      if (fs.existsSync(globalPlansDir)) {
        if (watcherState?.pollTimer) {
          clearInterval(watcherState.pollTimer);
          watcherState.pollTimer = null;
        }
        attachFsWatch();
      }
    }, POLL_INTERVAL_MS);
  }
}

function stopWatcherInternal(): void {
  if (!watcherState) return;
  if (watcherState.watcher) {
    try {
      watcherState.watcher.close();
    } catch {}
  }
  if (watcherState.pollTimer) clearInterval(watcherState.pollTimer);
  if (watcherState.debounceTimer) clearTimeout(watcherState.debounceTimer);
  watcherState = null;
}

function stopWatcher(): void {
  if (!watcherState) return;
  watcherState.refCount--;
  if (watcherState.refCount <= 0) {
    stopWatcherInternal();
  }
}

export function registerPlanWatcherIpc(): void {
  ipcMain.handle('plan:watch-start', async () => {
    try {
      startWatcher();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('plan:watch-stop', async () => {
    stopWatcher();
    return { success: true };
  });

  ipcMain.handle('plan:read-file', async (_e, args: { fileName: string }) => {
    try {
      const filePath = path.join(globalPlansDir, args.fileName);
      if (!isInsidePlansDir(filePath)) {
        return { success: false, error: 'Path traversal denied' };
      }
      const content = await fs.promises.readFile(filePath, 'utf8');
      return { success: true, content };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('plan:list-files', async () => {
    try {
      if (!fs.existsSync(globalPlansDir)) {
        return { success: true, files: [] };
      }
      const entries = fs.readdirSync(globalPlansDir);
      const files = entries
        .filter((name) => name.endsWith('.md'))
        .map((name) => {
          try {
            const st = fs.statSync(path.join(globalPlansDir, name));
            return { name, mtime: st.mtimeMs };
          } catch {
            return { name, mtime: 0 };
          }
        })
        .sort((a, b) => b.mtime - a.mtime);
      return { success: true, files };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  });

  app.on('will-quit', () => {
    stopWatcherInternal();
  });
}
