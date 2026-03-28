import { ipcMain, BrowserWindow } from 'electron';
import { inferTaskNameFromProvider } from '../services/TaskNamingService';
import { log } from '../lib/logger';

export function registerTaskNamingIpc(): void {
  /**
   * Fire-and-forget task name inference via provider CLI.
   * Returns immediately; pushes 'task:nameInferred' to the renderer when done.
   */
  ipcMain.handle(
    'task:inferName',
    async (
      event,
      args: {
        taskId: string;
        providerId: string;
        initialPrompt: string;
        projectPath: string;
      }
    ) => {
      const { taskId, providerId, initialPrompt, projectPath } = args;

      void inferTaskNameFromProvider(providerId, initialPrompt, projectPath)
        .then((name) => {
          const win = BrowserWindow.fromWebContents(event.sender);
          if (!win || win.isDestroyed()) return;
          win.webContents.send('task:nameInferred', { taskId, name });
        })
        .catch((err: unknown) => {
          log.warn(`[TaskNaming] unexpected error for task ${taskId}: ${String(err)}`);
          const win = BrowserWindow.fromWebContents(event.sender);
          if (!win || win.isDestroyed()) return;
          win.webContents.send('task:nameInferred', { taskId, name: null });
        });

      return { accepted: true };
    }
  );
}
