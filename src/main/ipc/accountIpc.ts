import { ipcMain, BrowserWindow } from 'electron';
import { emdashAccountService } from '../services/EmdashAccountService';
import { githubService } from '../services/GitHubService';
import { log } from '../lib/logger';

export function registerAccountIpc() {
  ipcMain.handle('account:getSession', async () => {
    try {
      return { success: true, data: emdashAccountService.getSession() };
    } catch (error) {
      log.error('account:getSession failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('account:signIn', async () => {
    try {
      const result = await emdashAccountService.signIn();
      if (result.providerId === 'github') {
        await githubService.storeTokenFromOAuth(result.accessToken);
      }

      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        const win = windows[0];
        if (win.isMinimized()) win.restore();
        win.focus();
      }

      return { success: true, data: { user: result.user } };
    } catch (error) {
      log.error('account:signIn failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('account:signOut', async () => {
    try {
      await emdashAccountService.signOut();
      return { success: true };
    } catch (error) {
      log.error('account:signOut failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('account:checkServerHealth', async () => {
    try {
      const available = await emdashAccountService.checkServerHealth();
      return { success: true, data: { available } };
    } catch (error) {
      return { success: true, data: { available: false } };
    }
  });

  ipcMain.handle('account:validateSession', async () => {
    try {
      const valid = await emdashAccountService.validateSession();
      return { success: true, data: { valid } };
    } catch (error) {
      log.error('account:validateSession failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}
