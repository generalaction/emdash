export type PtyExitInfo = {
  exitCode: number | null;
  signal?: number | string;
};

export interface PtyDimensions {
  cols: number;
  rows: number;
}

export type PtySpawnSpec = PtyDimensions & {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  shellSetup?: string;
  tmuxSessionName?: string;
};

export interface PtyHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  /**
   * Register the runtime-owned data handler. Implementations may support more
   * listeners, but the pty-conversations runtime treats this as a single
   * subscription and fans output out internally.
   */
  onData(handler: (data: string) => void): void;
  /**
   * Register the runtime-owned exit handler. Implementations may support more
   * listeners, but callers should not rely on that.
   */
  onExit(handler: (info: PtyExitInfo) => void): void;
  getPid?(): number;
}

export type SpawnPty = (spec: PtySpawnSpec) => Promise<PtyHandle> | PtyHandle;
