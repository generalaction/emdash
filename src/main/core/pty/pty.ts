export type PtyExitInfo = {
  exitCode?: number;
  signal?: number | string;
};

export interface PtyDimensions {
  cols: number;
  rows: number;
}

export interface Pty {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(handler: (data: string) => void): void;
  onExit(handler: (info: PtyExitInfo) => void): void;
  /**
   * Local OS PID of the top-level PTY process. Only implemented by PTYs whose
   * process is sampleable from the main process (e.g. local `node-pty`).
   * Remote transports like SSH omit this — the owning process runs elsewhere.
   */
  getPid?(): number;
}
