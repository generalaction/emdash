/**
 * Browser shim for the Electron preload bridge.
 *
 * The desktop renderer reaches Electron through a five-method
 * `window.electronAPI` surface. In the web build the wire connection rides a
 * WebSocket (see seed-web-wire.ts), so only no-op implementations are needed
 * for the boot watchdog escape hatch and misc helpers.
 */
export function installElectronApiShim(): void {
  const w = window as unknown as {
    electronAPI?: {
      getPathForFile: (file: File) => string;
      requestWirePort: (channel: string) => Promise<void>;
      onBootStuck: (callback: (payload: { stuckPhase: string }) => void) => () => void;
      requestBootEscape: (action: 'restart' | 'open-recovery') => Promise<void>;
      reportBootUsable: () => void;
    };
  };
  w.electronAPI = {
    getPathForFile: () => '',
    requestWirePort: async () => {
      /* wire rides WebSocket in the web build; never called */
    },
    onBootStuck: () => () => undefined,
    requestBootEscape: async (action) => {
      if (action === 'restart') window.location.reload();
    },
    reportBootUsable: () => {
      /* no desktop watchdog in the web build */
    },
  };
}
