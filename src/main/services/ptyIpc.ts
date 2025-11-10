import { app, ipcMain, WebContents } from 'electron';
import { startPty, writePty, resizePty, killPty, getPty } from './ptyManager';
import { log } from '../lib/logger';
import { terminalSnapshotService } from './TerminalSnapshotService';
import type { TerminalSnapshotPayload } from '../types/terminalSnapshot';

const owners = new Map<string, WebContents>();
const listeners = new Set<string>();

function safeSendToOwner(id: string, channel: string, payload: any): boolean {
  const wc = owners.get(id);
  if (!wc) return false;
  try {
    if (typeof (wc as any).isDestroyed === 'function' && (wc as any).isDestroyed()) {
      return false;
    }
    wc.send(channel, payload);
    return true;
  } catch (err) {
    // Swallow errors that occur if the renderer closed while data was in-flight
    log.warn('ptyIpc:sendFailed', { id, channel, error: String((err as any)?.message || err) });
    return false;
  }
}

export function registerPtyIpc(): void {
  ipcMain.handle(
    'pty:start',
    (
      event,
      args: {
        id: string;
        cwd?: string;
        shell?: string;
        env?: Record<string, string>;
        cols?: number;
        rows?: number;
      }
    ) => {
      try {
        const { id, cwd, shell, env, cols, rows } = args;
        // Reuse existing PTY if present; otherwise create new
        const existing = getPty(id);
        const proc = existing ?? startPty({ id, cwd, shell, env, cols, rows });
        const envKeys = env ? Object.keys(env) : [];
        const planEnv = env && (env.EMDASH_PLAN_MODE || env.EMDASH_PLAN_FILE) ? true : false;
        log.debug('pty:start OK', {
          id,
          cwd,
          shell,
          cols,
          rows,
          reused: !!existing,
          envKeys,
          planEnv,
        });
        const wc = event.sender;
        owners.set(id, wc);

        // If the owning WebContents is destroyed (window closed), kill PTY and cleanup
        try {
          wc.once('destroyed', () => {
            log.debug('pty:ownerDestroyed', { id });
            try {
              killPty(id);
            } catch {}
            owners.delete(id);
            listeners.delete(id);
          });
        } catch {}

        // Attach listeners once per PTY id
        if (!listeners.has(id)) {
          proc.onData((data) => {
            // Guard against sending to destroyed/non-existent webContents
            safeSendToOwner(id, `pty:data:${id}`, data);
          });

          proc.onExit(({ exitCode, signal }) => {
            // Notify owner if still alive; otherwise drop silently
            safeSendToOwner(id, `pty:exit:${id}`, { exitCode, signal });
            owners.delete(id);
            listeners.delete(id);
          });
          listeners.add(id);
        }

        // Signal that PTY is ready so renderer may inject initial prompt safely
        try {
          const { BrowserWindow } = require('electron');
          const windows = BrowserWindow.getAllWindows();
          windows.forEach((w: any) => w.webContents.send('pty:started', { id }));
        } catch {}

        return { ok: true };
      } catch (err: any) {
        log.error('pty:start FAIL', {
          id: args.id,
          cwd: args.cwd,
          shell: args.shell,
          error: err?.message || err,
        });
        return { ok: false, error: String(err?.message || err) };
      }
    }
  );

  ipcMain.on('pty:input', (_event, args: { id: string; data: string }) => {
    try {
      writePty(args.id, args.data);
    } catch (e) {
      log.error('pty:input error', { id: args.id, error: e });
    }
  });

  ipcMain.on('pty:resize', (_event, args: { id: string; cols: number; rows: number }) => {
    try {
      resizePty(args.id, args.cols, args.rows);
    } catch (e) {
      log.error('pty:resize error', { id: args.id, cols: args.cols, rows: args.rows, error: e });
    }
  });

  ipcMain.on('pty:kill', (_event, args: { id: string }) => {
    try {
      killPty(args.id);
      owners.delete(args.id);
      listeners.delete(args.id);
    } catch (e) {
      log.error('pty:kill error', { id: args.id, error: e });
    }
  });

  ipcMain.handle('pty:snapshot:get', async (_event, args: { id: string }) => {
    try {
      const snapshot = await terminalSnapshotService.getSnapshot(args.id);
      return { ok: true, snapshot };
    } catch (error: any) {
      log.error('pty:snapshot:get failed', { id: args.id, error });
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle(
    'pty:snapshot:save',
    async (_event, args: { id: string; payload: TerminalSnapshotPayload }) => {
      const { id, payload } = args;
      const result = await terminalSnapshotService.saveSnapshot(id, payload);
      if (!result.ok) {
        log.warn('pty:snapshot:save failed', { id, error: result.error });
      }
      return result;
    }
  );

  ipcMain.handle('pty:snapshot:clear', async (_event, args: { id: string }) => {
    await terminalSnapshotService.deleteSnapshot(args.id);
    return { ok: true };
  });
}

// Ensure no orphan PTYs keep running during app shutdown
try {
  app.on('before-quit', () => {
    for (const id of Array.from(owners.keys())) {
      try {
        killPty(id);
      } catch {}
    }
    owners.clear();
    listeners.clear();
  });
} catch {}
