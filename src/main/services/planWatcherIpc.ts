import { ipcMain, BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const PLANS_DIR = '.claude/plans';
const DEBOUNCE_MS = 300;
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 150; // 5 minutes

interface WatcherEntry {
  watcher: fs.FSWatcher | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

const watchers = new Map<string, WatcherEntry>();

function broadcast(channel: string, payload: any) {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send(channel, payload);
      } catch {}
    }
  } catch {}
}

function getPlansDir(taskPath: string): string {
  return path.join(taskPath, PLANS_DIR);
}

function isInsidePlansDir(filePath: string, taskPath: string): boolean {
  const plansDir = path.resolve(getPlansDir(taskPath));
  const resolved = path.resolve(filePath);
  return resolved.startsWith(plansDir + path.sep) || resolved === plansDir;
}

function startWatcher(taskPath: string): void {
  const existing = watchers.get(taskPath);
  if (existing?.watcher || existing?.pollTimer) return;

  const plansDir = getPlansDir(taskPath);

  const attachFsWatch = () => {
    try {
      const watcher = fs.watch(plansDir, (eventType, filename) => {
        if (!filename || !filename.endsWith('.md')) return;

        const entry = watchers.get(taskPath);
        if (!entry) return;

        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        entry.debounceTimer = setTimeout(() => {
          broadcast('plan:file-changed', {
            taskPath,
            fileName: filename,
            eventType,
          });
        }, DEBOUNCE_MS);
      });

      const entry = watchers.get(taskPath);
      if (entry) {
        entry.watcher = watcher;
        if (entry.pollTimer) {
          clearInterval(entry.pollTimer);
          entry.pollTimer = null;
        }
      }

      watcher.on('error', () => {
        stopWatcher(taskPath);
      });
    } catch {}
  };

  if (fs.existsSync(plansDir)) {
    watchers.set(taskPath, { watcher: null, pollTimer: null, debounceTimer: null });
    attachFsWatch();
  } else {
    let attempts = 0;
    const pollTimer = setInterval(() => {
      attempts++;
      if (attempts > MAX_POLL_ATTEMPTS) {
        clearInterval(pollTimer);
        const entry = watchers.get(taskPath);
        if (entry) entry.pollTimer = null;
        return;
      }
      if (fs.existsSync(plansDir)) {
        clearInterval(pollTimer);
        const entry = watchers.get(taskPath);
        if (entry) entry.pollTimer = null;
        attachFsWatch();
      }
    }, POLL_INTERVAL_MS);

    watchers.set(taskPath, { watcher: null, pollTimer, debounceTimer: null });
  }
}

function stopWatcher(taskPath: string): void {
  const entry = watchers.get(taskPath);
  if (!entry) return;

  if (entry.watcher) {
    try {
      entry.watcher.close();
    } catch {}
  }
  if (entry.pollTimer) clearInterval(entry.pollTimer);
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  watchers.delete(taskPath);
}

export function registerPlanWatcherIpc(): void {
  ipcMain.handle('plan:watch-start', async (_e, taskPath: string) => {
    try {
      startWatcher(taskPath);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('plan:watch-stop', async (_e, taskPath: string) => {
    stopWatcher(taskPath);
    return { success: true };
  });

  ipcMain.handle('plan:read-file', async (_e, args: { taskPath: string; fileName: string }) => {
    try {
      const filePath = path.join(getPlansDir(args.taskPath), args.fileName);
      if (!isInsidePlansDir(filePath, args.taskPath)) {
        return { success: false, error: 'Path traversal denied' };
      }
      const content = fs.readFileSync(filePath, 'utf8');
      return { success: true, content };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('plan:list-files', async (_e, taskPath: string) => {
    try {
      const plansDir = getPlansDir(taskPath);
      if (!fs.existsSync(plansDir)) {
        return { success: true, files: [] };
      }
      const entries = fs.readdirSync(plansDir);
      const files = entries
        .filter((name) => name.endsWith('.md'))
        .map((name) => {
          try {
            const st = fs.statSync(path.join(plansDir, name));
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
    for (const taskPath of watchers.keys()) {
      stopWatcher(taskPath);
    }
  });
}
