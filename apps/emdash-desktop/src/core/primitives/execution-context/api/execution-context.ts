export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  timeout?: number;
  maxBuffer?: number;
  signal?: AbortSignal;
}

export interface IExecutionContext {
  readonly root?: string;
  readonly supportsLocalSpawn: boolean;
  exec(command: string, args?: string[], opts?: ExecOptions): Promise<ExecResult>;
  refreshShellEnv?(): Promise<void>;
  execStreaming(
    command: string,
    args: string[],
    onChunk: (chunk: string) => boolean,
    opts?: { signal?: AbortSignal }
  ): Promise<void>;
  dispose(): void;
}
