import type { LiveLogSourceOptions } from '@emdash/wire/live';
import { LiveLogSource } from '@emdash/wire/live';
import { TerminalCapabilityResponder } from './terminal-capability-responder';
import type { PtyExitInfo, PtyProcess, PtySpawnSpec } from './types';

export interface PtySessionOptions {
  tmux?: boolean;
  log?: LiveLogSourceOptions;
  output?: LiveLogSource;
  onProcess?: (process: PtyProcess) => void;
  onData?: (chunk: string) => void;
  onExit?: (info: PtyExitInfo) => void;
  onStateChange?: () => void;
}

export class PtySession {
  readonly output: LiveLogSource;
  readonly startedAt = Date.now();
  private disposed = false;
  private exitInfo: PtyExitInfo | null = null;

  constructor(
    readonly key: string,
    readonly spec: PtySpawnSpec,
    private readonly process: PtyProcess,
    private readonly options: PtySessionOptions = {}
  ) {
    this.output = options.output ?? new LiveLogSource(options.log);
    const capabilities = options.tmux
      ? new TerminalCapabilityResponder((reply) => this.write(reply))
      : null;
    this.process.onData((chunk) => {
      if (this.disposed) return;
      const output = capabilities ? capabilities.push(chunk) : chunk;
      if (output) {
        this.output.append(output);
        this.options.onData?.(output);
      }
      this.options.onStateChange?.();
    });
    this.process.onExit((info) => {
      const pending = capabilities?.finish();
      if (pending && !this.disposed) {
        this.output.append(pending);
        this.options.onData?.(pending);
      }
      this.exitInfo = normalizeExitInfo(info);
      this.options.onExit?.(this.exitInfo);
      this.options.onStateChange?.();
    });
  }

  get exitStatus(): PtyExitInfo | null {
    return this.exitInfo;
  }

  get exited(): boolean {
    return this.exitInfo !== null;
  }

  write(data: string): void {
    if (this.disposed || this.exited) return;
    this.process.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.disposed || this.exited) return;
    this.process.resize(cols, rows);
  }

  kill(): void {
    if (this.disposed) return;
    this.process.kill();
  }

  dispose(): void {
    if (this.disposed) return;
    this.kill();
    this.disposed = true;
  }

  getPid(): number | undefined {
    return this.process.getPid?.();
  }
}

function normalizeExitInfo(info: PtyExitInfo): PtyExitInfo {
  return {
    exitCode: info.exitCode ?? null,
    signal: info.signal ?? null,
  };
}
