import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

function isWindows() {
  return process.platform === 'win32';
}

function isSymlink(p: string) {
  try {
    const st = fs.lstatSync(p);
    return st.isSymbolicLink();
  } catch {
    return false;
  }
}

type Entry = { p: string; m: number };

function collectPaths(root: string) {
  const result: string[] = [];
  const stack = ['.'];
  while (stack.length) {
    const rel = stack.pop()!;
    const abs = path.join(root, rel);
    if (isSymlink(abs)) continue;
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // Skip our internal folder so we can write logs/policies
      if (rel === '.emdash' || rel.startsWith('.emdash' + path.sep)) continue;
      result.push(rel);
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(abs);
      } catch {
        continue;
      }
      for (const e of entries) {
        const nextRel = rel === '.' ? e : path.join(rel, e);
        stack.push(nextRel);
      }
    } else if (st.isFile()) {
      result.push(rel);
    }
  }
  return result;
}

function chmodNoWrite(mode: number, isDir: boolean): number {
  const noWrite = mode & ~0o222; // clear write bits
  if (isDir) {
    // Ensure traverse bits present
    return (noWrite | 0o111) & 0o7777;
  }
  return noWrite & 0o7777;
}

function applyLock(root: string): { success: boolean; changed: number; error?: string } {
  try {
    const entries = collectPaths(root);
    const state: Entry[] = [];
    let changed = 0;
    for (const rel of entries) {
      const abs = path.join(root, rel);
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      const isDir = st.isDirectory();
      const prevMode = st.mode & 0o7777;
      const nextMode = chmodNoWrite(prevMode, isDir);
      if (nextMode !== prevMode) {
        try {
          fs.chmodSync(abs, nextMode);
          state.push({ p: rel, m: prevMode });
          changed++;
        } catch {}
      }
    }
    // Persist lock state
    const baseDir = path.join(root, '.emdash');
    try {
      fs.mkdirSync(baseDir, { recursive: true });
    } catch {}
    const statePath = path.join(baseDir, '.planlock.json');
    try {
      fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');
    } catch {}
    return { success: true, changed };
  } catch (e: any) {
    return { success: false, changed: 0, error: e?.message || String(e) };
  }
}

function releaseLock(root: string): { success: boolean; restored: number; error?: string } {
  try {
    const statePath = path.join(root, '.emdash', '.planlock.json');
    if (!fs.existsSync(statePath)) return { success: true, restored: 0 };
    let raw = '';
    try {
      raw = fs.readFileSync(statePath, 'utf8');
    } catch {}
    let entries: Entry[] = [];
    try {
      entries = JSON.parse(raw || '[]');
    } catch {}
    let restored = 0;
    for (const ent of entries) {
      try {
        const abs = path.join(root, ent.p);
        fs.chmodSync(abs, ent.m);
        restored++;
      } catch {}
    }
    // Cleanup state file
    try {
      fs.unlinkSync(statePath);
    } catch {}
    return { success: true, restored };
  } catch (e: any) {
    return { success: false, restored: 0, error: e?.message || String(e) };
  }
}

export function registerPlanLockIpc(): void {
  ipcMain.handle('plan:lock', async (_e, taskPath: string) => {
    if (isWindows()) {
      // Best-effort: still attempt chmod; ACL hardening could be added with icacls in a future pass
      return applyLock(taskPath);
    }
    return applyLock(taskPath);
  });

  ipcMain.handle('plan:unlock', async (_e, taskPath: string) => {
    if (isWindows()) {
      return releaseLock(taskPath);
    }
    return releaseLock(taskPath);
  });
}
