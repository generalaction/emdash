export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  timeout?: number;
  maxBuffer?: number;
  signal?: AbortSignal;
}

/**
 * An execution context represents a host + optional working directory where commands run.
 * Implementations abstract the transport (local spawn vs SSH exec) so consumers
 * have no knowledge of whether they are running locally or remotely.
 */
export interface IExecutionContext {
  /** The working directory all commands run in. Undefined/empty = no cwd constraint. */
  readonly root?: string;

  /**
   * True only for LocalExecutionContext. Used by GitService to decide
   * whether to use CatFileBatch (local spawn) or git-show fallback (SSH).
   */
  readonly supportsLocalSpawn: boolean;

  /**
   * Whether the host this context executes on is Windows. Consumers must use
   * this — not the local `process.platform` — when picking platform-specific
   * commands (e.g. `where` vs `which`), so a Windows client connected to a
   * POSIX remote over SSH still runs the right command on the remote host.
   * SSH remotes are POSIX, so this is always false for them.
   */
  readonly isWindows: boolean;

  /** Run a command and buffer all output. Rejects on non-zero exit code. */
  exec(command: string, args?: string[], opts?: ExecOptions): Promise<ExecResult>;

  /**
   * Refresh any cached shell environment for this context. Installers often
   * write shell startup files or install into paths that become visible only
   * after recapturing the user's shell environment.
   */
  refreshShellEnv?(): Promise<void>;

  /**
   * Run a command and stream stdout chunks to `onChunk`.
   * Return false from `onChunk` to abort the process early (resolves normally).
   * Passing `signal` rejects with an AbortError when the signal fires.
   */
  execStreaming(
    command: string,
    args: string[],
    onChunk: (chunk: string) => boolean,
    opts?: { signal?: AbortSignal }
  ): Promise<void>;

  /**
   * Abort all in-flight exec/execStreaming calls and release resources.
   * Idempotent — safe to call multiple times.
   */
  dispose(): void;
}
