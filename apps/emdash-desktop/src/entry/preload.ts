import { requestWirePort, type WindowLike } from '@emdash/wire/rpc';
import { contextBridge, ipcRenderer, webUtils } from 'electron';

// Preload is typechecked by the node program (no DOM lib), but runs in the
// renderer where `window` exists; declare it with the structural type wire needs.
declare const window: WindowLike;

// Expose protected methods that allow the renderer process to use
contextBridge.exposeInMainWorld('electronAPI', {
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  requestWirePort: (channel: string) => requestWirePort({ ipcRenderer, window }, { channel }),
});
