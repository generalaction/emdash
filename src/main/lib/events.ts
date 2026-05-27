import { ipcMain } from 'electron';
import { getMainWindow } from '@main/app/window';
import { createEventEmitter, type EmitterAdapter } from '@shared/ipc/events';

function createMainAdapter(): EmitterAdapter {
  return {
    emit: (eventName: string, data: unknown, topic?: string) => {
      const channel = topic ? `${eventName}.${topic}` : eventName;
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    },
    on: (eventName: string, cb: (data: unknown) => void, topic?: string) => {
      const channel = topic ? `${eventName}.${topic}` : eventName;
      const handler = (_e: Electron.IpcMainEvent, data: unknown) => cb(data);
      ipcMain.on(channel, handler);
      return () => ipcMain.removeListener(channel, handler);
    },
  };
}

export const events = createEventEmitter(createMainAdapter());
