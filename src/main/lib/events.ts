import { ipcMain } from 'electron';
import { createEventEmitter, type EmitterAdapter } from '@shared/ipc/events';
import { getMainWindow } from '@main/app/window';
import { log } from '@main/lib/logger';

function createMainAdapter(): EmitterAdapter {
  const localListeners = new Map<string, Set<(data: unknown) => void>>();

  return {
    emit: (eventName: string, data: unknown, topic?: string) => {
      const channel = topic ? `${eventName}.${topic}` : eventName;
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
      const set = localListeners.get(channel);
      if (set) {
        for (const cb of set) {
          try {
            cb(data);
          } catch (error) {
            log.error('events.localListener threw', { channel, error: String(error) });
          }
        }
      }
    },
    on: (eventName: string, cb: (data: unknown) => void, topic?: string) => {
      const channel = topic ? `${eventName}.${topic}` : eventName;
      const ipcHandler = (_e: Electron.IpcMainEvent, data: unknown) => cb(data);
      ipcMain.on(channel, ipcHandler);
      let set = localListeners.get(channel);
      if (!set) {
        set = new Set();
        localListeners.set(channel, set);
      }
      set.add(cb);
      return () => {
        ipcMain.removeListener(channel, ipcHandler);
        const current = localListeners.get(channel);
        if (current) {
          current.delete(cb);
          if (current.size === 0) localListeners.delete(channel);
        }
      };
    },
  };
}

export const events = createEventEmitter(createMainAdapter());
