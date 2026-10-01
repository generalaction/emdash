import type { Duplex } from 'node:stream';
import type { Command } from '@emdash/core/primitives/exec/api';

export type SshExecOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
};
export type SshExecResult = { stdout: string; stderr: string; exitCode: number };
export type SshForwardOptions = {
  preferredLocalPort?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};
export type SshPortForward = {
  localPort: number;
  closed: Promise<Error | undefined>;
  close(): Promise<void>;
};

export interface SshClientProxy {
  readonly connectionId: string;
  readonly isConnected: boolean;
  exec(command: Command, options?: SshExecOptions): Promise<SshExecResult>;
  execScript(script: string, options?: SshExecOptions): Promise<SshExecResult>;
  openStream(
    command: Command,
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<Duplex>;
  forwardPort(remotePort: number, options?: SshForwardOptions): Promise<SshPortForward>;
}
