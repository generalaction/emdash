// Type declarations for the Electron preload API exposed on window.electronAPI.
// Only methods actually exposed by src/preload/index.ts are declared here.
// All other IPC methods are accessed via the typed RPC client (src/renderer/lib/rpc.ts).

export type ProviderCustomConfig = {
  model?: string;
  cli?: string;
  resumeFlag?: string;
  defaultArgs?: string;
  autoApproveFlag?: string;
  initialPromptFlag?: string;
  extraArgs?: string;
  env?: Record<string, string>;
};

export type ProviderCustomConfigs = Record<string, ProviderCustomConfig>;

export {};

declare global {
  interface Window {
    electronAPI: {
      // Core bridges for the typed RPC client and event emitter
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      eventSend: (channel: string, data: unknown) => void;
      eventOn: (channel: string, cb: (data: unknown) => void) => () => void;

      // App actions that use event.sender
      openIn: (args: {
        app: string;
        path: string;
        isRemote?: boolean;
        sshConnectionId?: string;
      }) => Promise<any>;

      // PTY management — pty:start and pty:startDirect kept manual (event.sender dependency)
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
      }) => Promise<{ ok: boolean; error?: string }>;
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
      }) => Promise<{ ok: boolean; reused?: boolean; error?: string }>;

      // Fire-and-forget PTY operations (ipcRenderer.send, not invoke)
      ptyInput: (args: { id: string; data: string }) => void;
      ptyResize: (args: { id: string; cols: number; rows: number }) => void;
      ptyKill: (id: string) => void;

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
      ) => Promise<{
        success: boolean;
        items?: Array<{ path: string; type: 'file' | 'dir' }>;
        error?: string;
        canceled?: boolean;
        truncated?: boolean;
        reason?: string;
        durationMs?: number;
      }>;
    };
  }
}
