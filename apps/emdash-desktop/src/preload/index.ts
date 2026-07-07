import { contextBridge, ipcRenderer, webUtils } from 'electron';

// Expose protected methods that allow the renderer process to use
contextBridge.exposeInMainWorld('electronAPI', {
  // Generic invoke for the typed RPC client (createRPCClient)
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  // Generic event bridge for the typesafe event emitter (createEventEmitter)
  eventSend: (channel: string, data: unknown) => ipcRenderer.send(channel, data),
  eventOn: (channel: string, cb: (data: unknown) => void) => {
    const wrapped = (_: Electron.IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
});
