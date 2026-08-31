import type { NativeInvocation } from '#primitives/exec/api';
import type { PtySignal } from './exit-signals';

export interface PtyDimensions {
  cols: number;
  rows: number;
}

export interface PtyExitInfo {
  exitCode: number | null;
  signal: PtySignal | null;
}

export interface PtyProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(handler: (data: string) => void): void;
  onExit(handler: (info: PtyExitInfo) => void): void;
  getPid?(): number;
}

export interface PtySpawnSpec extends PtyDimensions {
  invocation: NativeInvocation;
  cwd: string;
  env: Record<string, string>;
}

export interface PtySpawner {
  spawn(spec: PtySpawnSpec): PtyProcess | Promise<PtyProcess>;
}
