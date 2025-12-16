import { ipcMain, BrowserWindow } from 'electron';
import { hostPreviewService } from '../services/hostPreviewService';

export function registerHostPreviewIpc() {
  ipcMain.handle(
    'preview:host:start',
    async (
      _e,
      args: {
        taskId: string;
        taskPath: string;
        script?: string;
        parentProjectPath?: string;
      }
    ) => {
      const id = String(args?.taskId || '').trim();
      const wp = String(args?.taskPath || '').trim();
      if (!id || !wp) return { ok: false, error: 'taskId and taskPath are required' };
      return hostPreviewService.start(id, wp, {
        script: args?.script,
        parentProjectPath: args?.parentProjectPath,
      });
    }
  );

  ipcMain.handle('preview:host:setup', async (_e, args: { taskId: string; taskPath: string }) => {
    const id = String(args?.taskId || '').trim();
    const wp = String(args?.taskPath || '').trim();
    if (!id || !wp) return { ok: false, error: 'taskId and taskPath are required' };
    return hostPreviewService.setup(id, wp);
  });

  ipcMain.handle('preview:host:stop', async (_e, id: string) => {
    const wid = String(id || '').trim();
    if (!wid) return { ok: true };
    return hostPreviewService.stop(wid);
  });

  ipcMain.handle('preview:host:stopAll', async (_e, exceptId?: string) => {
    const ex = typeof exceptId === 'string' ? exceptId : '';
    return hostPreviewService.stopAll(ex);
  });

  const forward = (evt: any) => {
    const all = BrowserWindow.getAllWindows();
    for (const win of all) {
      try {
        win.webContents.send('preview:host:event', evt);
      } catch {}
    }
  };
  hostPreviewService.onEvent(forward);
}
