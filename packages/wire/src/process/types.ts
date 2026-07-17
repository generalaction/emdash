import type { Unsubscribe } from '@emdash/shared';
import type { Scope } from '../util';

export type ProcessSupervision =
  | {
      restart: 'never';
    }
  | {
      restart: 'on-failure';
      backoffMs?: number[];
      maxRestarts?: number;
    };

export type ProcessSpec = {
  entry: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  supervision?: ProcessSupervision;
  gracefulShutdown?: {
    message?: unknown;
    graceMs: number;
  };
};

export type ProcessExit = {
  code: number | null;
  signal?: string | null;
};

export type ManagedProcessExit = ProcessExit & {
  willRestart: boolean;
};

export type StdioStream = 'stdout' | 'stderr';

export interface ManagedProcess {
  readonly pid: number | undefined;
  send(message: unknown): void;
  onMessage(cb: (message: unknown) => void): Unsubscribe;
  onExit(cb: (exit: ManagedProcessExit) => void): Unsubscribe;
  onStdio(cb: (stream: StdioStream, chunk: string) => void): Unsubscribe;
  dispose(): Promise<void>;
}

export interface ProcessHost {
  spawn(spec: ProcessSpec, scope?: Scope): Promise<ManagedProcess>;
}

export interface ChildHandle {
  readonly pid?: number;
  send(message: unknown): void;
  onMessage(cb: (message: unknown) => void): Unsubscribe;
  onExit(cb: (exit: ProcessExit) => void): Unsubscribe;
  onStdio(cb: (stream: StdioStream, chunk: string) => void): Unsubscribe;
  kill(): void | Promise<void>;
}

export type SpawnChild = (spec: ProcessSpec, scope: Scope) => ChildHandle | Promise<ChildHandle>;
