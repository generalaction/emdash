import { EventEmitter } from 'events';
import { SshService } from './ssh/SshService';
import { quoteShellArg, isValidEnvVarName } from '../utils/shellEscape';

export interface RemotePtyOptions {
  id: string;
  connectionId: string;
  cwd: string;
  shell: string;
  autoApprove?: boolean;
  initialPrompt?: string;
  env?: Record<string, string>;
}

export interface RemotePty {
  id: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (code: number) => void): void;
}

/**
 * Allowlist of shells that can be launched as remote PTYs.
 * Only absolute paths to well-known shells are permitted.
 */
const ALLOWED_SHELLS = new Set([
  '/bin/bash',
  '/bin/sh',
  '/bin/zsh',
  '/usr/bin/bash',
  '/usr/bin/zsh',
  '/usr/bin/fish',
  '/usr/local/bin/bash',
  '/usr/local/bin/zsh',
  '/usr/local/bin/fish',
]);

/**
 * Service for managing remote PTY (pseudo-terminal) sessions over SSH.
 *
 * This service allows running interactive shell sessions on remote machines,
 * including AI agent CLIs like Codex, Claude, etc. It provides:
 * - Interactive shell sessions via ssh2
 * - Environment variable support
 * - Working directory configuration
 * - Auto-approve flag support for agents
 * - Proper cleanup on exit
 */
export class RemotePtyService extends EventEmitter {
  private ptys: Map<string, RemotePty> = new Map();

  constructor(private sshService: SshService) {
    super();
  }

  /**
   * Starts a new remote PTY session on an established SSH connection.
   *
   * @param options - Configuration for the remote PTY session
   * @returns The created RemotePty instance
   * @throws Error if connection not found or shell creation fails
   */
  async startRemotePty(options: RemotePtyOptions): Promise<RemotePty> {
    const connection = this.sshService.getConnection(options.connectionId);
    if (!connection) {
      throw new Error(`Connection ${options.connectionId} not found`);
    }

    const client = connection.client;

    return new Promise((resolve, reject) => {
      client.shell((err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        // Build command with environment and cwd
        // Validate env var keys to prevent injection (CRITICAL #1)
        const envEntries = Object.entries(options.env || {}).filter(([k]) => {
          if (!isValidEnvVarName(k)) {
            console.warn(`[RemotePtyService] Skipping invalid env var name: ${k}`);
            return false;
          }
          return true;
        });
        const envVars = envEntries
          .map(([k, v]) => `export ${k}=${quoteShellArg(v)}`)
          .join(' && ');

        const cdCommand = options.cwd ? `cd ${quoteShellArg(options.cwd)}` : '';
        const autoApproveFlag = options.autoApprove ? ' --full-auto' : '';

        // Validate shell against allowlist (HIGH #5)
        const shellBinary = options.shell.split(/\s+/)[0];
        if (!ALLOWED_SHELLS.has(shellBinary)) {
          reject(new Error(`Shell not allowed: ${shellBinary}. Allowed: ${[...ALLOWED_SHELLS].join(', ')}`));
          return;
        }

        const fullCommand = [envVars, cdCommand, `${options.shell}${autoApproveFlag}`]
          .filter(Boolean)
          .join(' && ');

        // Send initial command
        stream.write(fullCommand + '\n');

        // Send initial prompt if provided
        if (options.initialPrompt) {
          setTimeout(() => {
            stream.write(options.initialPrompt + '\n');
          }, 500);
        }

        const pty: RemotePty = {
          id: options.id,
          write: (data: string) => stream.write(data),
          // ssh2 expects rows, cols, height, width
          resize: (cols: number, rows: number) => stream.setWindow(rows, cols, 0, 0),
          kill: () => stream.close(),
          onData: (callback) => stream.on('data', (data: Buffer) => callback(data.toString())),
          onExit: (callback) => stream.on('close', () => callback(0)),
        };

        this.ptys.set(options.id, pty);

        stream.on('close', () => {
          this.ptys.delete(options.id);
          this.emit('exit', options.id);
        });

        resolve(pty);
      });
    });
  }

  /**
   * Writes data to a remote PTY session.
   *
   * @param ptyId - ID of the PTY session
   * @param data - Data to write
   */
  write(ptyId: string, data: string): void {
    const pty = this.ptys.get(ptyId);
    if (pty) {
      pty.write(data);
    }
  }

  /**
   * Resizes a remote PTY session.
   *
   * @param ptyId - ID of the PTY session
   * @param cols - Number of columns
   * @param rows - Number of rows
   */
  resize(ptyId: string, cols: number, rows: number): void {
    const pty = this.ptys.get(ptyId);
    if (pty) {
      pty.resize(cols, rows);
    }
  }

  /**
   * Kills a remote PTY session.
   *
   * @param ptyId - ID of the PTY session
   */
  kill(ptyId: string): void {
    const pty = this.ptys.get(ptyId);
    if (pty) {
      pty.kill();
      this.ptys.delete(ptyId);
    }
  }

  /**
   * Gets a PTY session by ID.
   *
   * @param ptyId - ID of the PTY session
   * @returns The RemotePty instance or undefined
   */
  getPty(ptyId: string): RemotePty | undefined {
    return this.ptys.get(ptyId);
  }

  /**
   * Checks if a PTY session exists.
   *
   * @param ptyId - ID of the PTY session
   * @returns true if the PTY exists
   */
  hasPty(ptyId: string): boolean {
    return this.ptys.has(ptyId);
  }
}
