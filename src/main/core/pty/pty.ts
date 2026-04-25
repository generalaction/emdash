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
}
