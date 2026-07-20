import { contextBridge, ipcRenderer } from 'electron';

const recoveryApi = {
  getState: () => ipcRenderer.invoke('recovery:get-state'),
  check: () => ipcRenderer.invoke('recovery:check'),
  download: () => ipcRenderer.invoke('recovery:download'),
  install: () => ipcRenderer.invoke('recovery:install'),
  restart: () => ipcRenderer.invoke('recovery:restart'),
  tryNormalStart: () => ipcRenderer.invoke('recovery:try-normal-start'),
  openLogs: () => ipcRenderer.invoke('recovery:open-logs'),
  quit: () => ipcRenderer.invoke('recovery:quit'),
  onUpdate: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on('recovery:update-event', wrapped);
    return () => ipcRenderer.removeListener('recovery:update-event', wrapped);
  },
};

contextBridge.exposeInMainWorld('recoveryAPI', recoveryApi);
