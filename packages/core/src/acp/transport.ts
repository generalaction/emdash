import type { Readable, Writable } from 'node:stream';

// ---------------------------------------------------------------------------
// AcpProcessHandle: uniform view of a running agent process
// ---------------------------------------------------------------------------

/**
 * Uniform view of a running agent process, regardless of whether it is a local
 * child process or a remote SSH exec channel.
 */
export interface AcpProcessHandle {
  /** JSON-RPC framing input (writable end of the stdio pipe). */
  readonly stdin: Writable;
  /** JSON-RPC framing output (readable end of the stdio pipe). */
  readonly stdout: Readable;
  /** Optional separate stderr stream (not available on PTY channels). */
  readonly stderr?: Readable;
  /** Exit code if the process has already exited, null otherwise. */
  readonly exitCode: number | null;
  /** Register a callback to be called when the process exits. */
  onExit(cb: (code: number | null) => void): void;
  /** Register a callback to be called if the process emits an error. */
  onError(cb: (err: Error) => void): void;
  /** Send a termination signal to the process. */
  kill(signal?: NodeJS.Signals): void;
}

// ---------------------------------------------------------------------------
// AcpFs: minimal fs surface needed by the ACP client handler
// ---------------------------------------------------------------------------

export interface AcpFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, content: string, encoding: 'utf8'): Promise<void>;
  mkdir(path: string, opts: { recursive: boolean }): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// AcpProcessHost: per-machine spawn + fs abstraction
// ---------------------------------------------------------------------------

/**
 * Represents a specific machine's ACP process host: can resolve the agent
 * executable + env for a given provider, spawn an agent process, and provide a
 * file-system adapter for the ACP client file handlers.
 */
export interface AcpProcessHost {
  /**
   * Resolve the agent CLI path and environment variables for the given provider.
   * The host impl looks up binary names and cached paths internally.
   */
  resolveSpawnContext(
    providerId: string
  ): Promise<{ cli: string; agentEnv: Record<string, string> }>;

  /**
   * Spawn the agent process and return a handle to its stdio streams.
   */
  spawn(spec: {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
  }): Promise<AcpProcessHandle>;

  /** File system adapter scoped to the remote or local machine. */
  readonly fs: AcpFs;
}
