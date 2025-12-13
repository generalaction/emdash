import type { ElectronAPI } from './electron-api';

// Global type declarations for Electron API
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
