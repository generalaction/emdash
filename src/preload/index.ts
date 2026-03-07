import { contextBridge, ipcRenderer } from 'electron';
import type { OpenInAppId } from '../shared/openInApps';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
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

  // Update events — aggregated multi-channel listener (too complex to migrate to typed events)
  onUpdateEvent: (listener: (data: { type: string; payload?: any }) => void) => {
    const pairs: Array<[string, string]> = [
      ['update:checking', 'checking'],
      ['update:available', 'available'],
      ['update:not-available', 'not-available'],
      ['update:error', 'error'],
      ['update:downloading', 'downloading'],
      ['update:download-progress', 'download-progress'],
      ['update:downloaded', 'downloaded'],
      ['update:installing', 'installing'],
    ];
    const handlers: Array<() => void> = [];
    for (const [channel, type] of pairs) {
      const wrapped = (_: Electron.IpcRendererEvent, payload: any) => listener({ type, payload });
      ipcRenderer.on(channel, wrapped);
      handlers.push(() => ipcRenderer.removeListener(channel, wrapped));
    }
    return () => handlers.forEach((off) => off());
  },

  // Open a path in a specific app (uses event.sender implicitly via shell)
  openIn: (args: { app: OpenInAppId; path: string }) => ipcRenderer.invoke('app:openIn', args),

  // PTY management — pty:start and pty:startDirect need event.sender for PTY session tracking
  ptyStart: (opts: {
    id: string;
    cwd?: string;
    remote?: { connectionId: string };
    shell?: string;
    env?: Record<string, string>;
    cols?: number;
    rows?: number;
    autoApprove?: boolean;
    initialPrompt?: string;
  }) => ipcRenderer.invoke('pty:start', opts),

  // Fire-and-forget PTY operations
  ptyInput: (args: { id: string; data: string }) => ipcRenderer.send('pty:input', args),
  ptyResize: (args: { id: string; cols: number; rows: number }) =>
    ipcRenderer.send('pty:resize', args),
  ptyKill: (id: string) => ipcRenderer.send('pty:kill', { id }),

  // Direct PTY spawn — kept manual because it uses event.sender for shell config
  ptyStartDirect: (opts: {
    id: string;
    providerId: string;
    cwd: string;
    remote?: { connectionId: string };
    cols?: number;
    rows?: number;
    autoApprove?: boolean;
    initialPrompt?: string;
    clickTime?: number;
    env?: Record<string, string>;
    resume?: boolean;
  }) => ipcRenderer.invoke('pty:startDirect', opts),

  // Filesystem list — uses event.sender for per-sender worker cancellation
  fsList: (
    root: string,
    opts?: {
      includeDirs?: boolean;
      maxEntries?: number;
      timeBudgetMs?: number;
      connectionId?: string;
      remotePath?: string;
      recursive?: boolean;
    }
  ) => ipcRenderer.invoke('fs:list', { root, ...(opts || {}) }),
});
