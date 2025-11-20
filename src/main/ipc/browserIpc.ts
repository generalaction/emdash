import { ipcMain } from 'electron';
import { browserViewService } from '../services/browserViewService';

export function registerBrowserIpc() {
  ipcMain.handle(
    'browser:view:show',
    (_e, args: { x: number; y: number; width: number; height: number; url?: string }) => {
      const { x, y, width, height, url } = args || ({} as any);
      browserViewService.show({ x, y, width, height }, url);
      return { ok: true };
    }
  );
  ipcMain.handle('browser:view:hide', () => {
    browserViewService.hide();
    return { ok: true };
  });
  ipcMain.handle(
    'browser:view:setBounds',
    (_e, args: { x: number; y: number; width: number; height: number }) => {
      const { x, y, width, height } = args || ({} as any);
      browserViewService.setBounds({ x, y, width, height });
      return { ok: true };
    }
  );
  ipcMain.handle('browser:view:loadURL', (_e, url: string) => {
    browserViewService.loadURL(url);
    return { ok: true };
  });
  ipcMain.handle('browser:view:goBack', () => {
    browserViewService.goBack();
    return { ok: true };
  });
  ipcMain.handle('browser:view:goForward', () => {
    browserViewService.goForward();
    return { ok: true };
  });
  ipcMain.handle('browser:view:reload', () => {
    browserViewService.reload();
    return { ok: true };
  });
  ipcMain.handle('browser:view:openDevTools', () => {
    browserViewService.openDevTools();
    return { ok: true };
  });
}
