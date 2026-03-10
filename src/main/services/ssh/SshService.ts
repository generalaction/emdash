import { EventEmitter } from 'events';
import { Client, SFTPWrapper, ConnectConfig } from 'ssh2';
import { SshConfig, ExecResult } from '../../../shared/ssh/types';
import { Connection, ConnectionPool, GssapiConnection } from './types';
import { SshCredentialService } from './SshCredentialService';
import { quoteShellArg } from '../../utils/shellEscape';
import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { execFile, spawn, ChildProcess } from 'child_process';
import { access, unlink } from 'fs/promises';
import { resolveIdentityAgent } from '../../utils/sshConfigParser';

/** Maximum number of concurrent SSH connections allowed in the pool. */
const MAX_CONNECTIONS = 10;

/** Threshold (fraction of MAX_CONNECTIONS) at which a warning is logged. */
const POOL_WARNING_THRESHOLD = 0.8;

/**
 * Main SSH service for managing SSH connections, executing commands,
 * and handling SFTP operations.
 *
 * Extends EventEmitter to emit connection events:
 * - 'connected': When a connection is successfully established
 * - 'error': When a connection error occurs
 * - 'disconnected': When a connection is closed
 */
export class SshService extends EventEmitter {
  private connections: ConnectionPool = {};
  private gssapiConnections: Map<string, GssapiConnection> = new Map();
  private gssapiProcesses: Map<string, ChildProcess> = new Map();
  private pendingConnections: Map<string, Promise<string>> = new Map();
  private credentialService: SshCredentialService;

  constructor(credentialService?: SshCredentialService) {
    super();
    this.credentialService = credentialService ?? new SshCredentialService();
  }

  /**
   * Establishes a new SSH connection.
   *
   * Guards against duplicate connections:
   * - If a connection with this ID already exists and is alive, returns immediately.
   * - If a connection attempt for this ID is already in flight, coalesces onto
   *   the existing promise instead of opening a second TCP socket.
   * - Enforces a global MAX_CONNECTIONS limit to prevent resource exhaustion.
   *
   * @param config - SSH connection configuration
   * @returns Connection ID for future operations
   */
  async connect(config: SshConfig): Promise<string> {
    const connectionId = config.id ?? randomUUID();

    // 1. If already connected, reuse the existing connection
    if (this.connections[connectionId] || this.gssapiConnections.has(connectionId)) {
      return connectionId;
    }

    // 2. If a connection attempt is already in flight, coalesce
    const pending = this.pendingConnections.get(connectionId);
    if (pending) {
      return pending;
    }

    // 3. Enforce connection pool limit
    const poolSize =
      Object.keys(this.connections).length +
      this.gssapiConnections.size +
      this.pendingConnections.size;
    if (poolSize >= MAX_CONNECTIONS) {
      throw new Error(
        `SSH connection pool limit reached (${MAX_CONNECTIONS}). ` +
          'Disconnect unused connections before opening new ones.'
      );
    }
    if (poolSize >= MAX_CONNECTIONS * POOL_WARNING_THRESHOLD) {
      console.warn(
        `[SshService] Connection pool at ${poolSize}/${MAX_CONNECTIONS} — approaching limit`
      );
    }

    // 4. GSSAPI uses system ssh with ControlMaster instead of ssh2
    if (config.authType === 'gssapi') {
      const connectionPromise = this.connectGssapi(connectionId, config);
      this.pendingConnections.set(connectionId, connectionPromise);
      try {
        return await connectionPromise;
      } finally {
        this.pendingConnections.delete(connectionId);
      }
    }

    // 5. Create the ssh2 connection and track the in-flight promise
    const connectionPromise = this.createConnection(connectionId, config);
    this.pendingConnections.set(connectionId, connectionPromise);

    try {
      const result = await connectionPromise;
      return result;
    } finally {
      this.pendingConnections.delete(connectionId);
    }
  }

  /**
   * Internal: opens a new SSH connection and registers it in the pool.
   */
  private createConnection(connectionId: string, config: SshConfig): Promise<string> {
    const client = new Client();

    return new Promise((resolve, reject) => {
      // Handle connection errors
      client.on('error', (err: Error) => {
        reject(err);
      });

      // Handle connection close
      client.on('close', () => {
        // Only clean up if this client is still the one stored in the pool.
        // A stale client's close event must not remove a newer connection
        // that was established under the same connectionId.
        if (this.connections[connectionId]?.client === client) {
          delete this.connections[connectionId];
          this.emit('disconnected', connectionId);
        }
      });

      // Handle successful connection
      client.on('ready', () => {
        const connection: Connection = {
          id: connectionId,
          config,
          client,
          connectedAt: new Date(),
          lastActivity: new Date(),
        };

        this.connections[connectionId] = connection;
        this.emit('connected', connectionId);
        resolve(connectionId);
      });

      // Build connection config
      this.buildConnectConfig(connectionId, config)
        .then((connectConfig) => {
          client.connect(connectConfig);
        })
        .catch((err) => {
          // Never emit the special EventEmitter 'error' event unless
          // someone is explicitly listening; otherwise Node will throw
          // ERR_UNHANDLED_ERROR and can abort IPC replies.
          if (this.listenerCount('error') > 0) {
            this.emit('error', connectionId, err);
          }
          reject(err);
        });
    });
  }

  /**
   * Builds the ssh2 ConnectConfig from our SshConfig
   */
  private async buildConnectConfig(
    connectionId: string,
    config: SshConfig
  ): Promise<ConnectConfig> {
    const connectConfig: ConnectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: 20000,
      keepaliveInterval: 60000,
      keepaliveCountMax: 3,
    };

    switch (config.authType) {
      case 'password': {
        const inlinePassword = (config as any).password as string | undefined;
        const password = inlinePassword ?? (await this.credentialService.getPassword(connectionId));
        if (!password) {
          throw new Error(`No password found for connection ${connectionId}`);
        }
        connectConfig.password = password;
        break;
      }

      case 'key': {
        if (!config.privateKeyPath) {
          throw new Error('Private key path is required for key authentication');
        }
        try {
          // Expand ~ to home directory
          let keyPath = config.privateKeyPath;
          if (keyPath.startsWith('~/')) {
            keyPath = keyPath.replace('~', homedir());
          } else if (keyPath === '~') {
            keyPath = homedir();
          }

          const privateKey = await readFile(keyPath, 'utf-8');
          connectConfig.privateKey = privateKey;

          // Check for passphrase
          const inlinePassphrase = (config as any).passphrase as string | undefined;
          const passphrase =
            inlinePassphrase ?? (await this.credentialService.getPassphrase(connectionId));
          if (passphrase) {
            connectConfig.passphrase = passphrase;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to read private key: ${message}`);
        }
        break;
      }

      case 'agent': {
        const identityAgent = await resolveIdentityAgent(config.host);
        const agentSocket = identityAgent || process.env.SSH_AUTH_SOCK;
        if (!agentSocket) {
          throw new Error(
            'SSH agent authentication failed: no agent socket found. ' +
              'This typically happens when:\n' +
              '1. The SSH agent is not running (try running "eval $(ssh-agent -s)" in your terminal)\n' +
              '2. The app was launched from the GUI (Finder/Dock) instead of a terminal\n' +
              '3. The SSH agent socket path could not be auto-detected\n\n' +
              'Workarounds:\n' +
              '• Add IdentityAgent to this host in ~/.ssh/config (e.g. for 1Password)\n' +
              '• Launch Emdash from your terminal where SSH agent is already configured\n' +
              '• Use SSH key authentication instead of agent authentication\n' +
              '• Ensure your SSH agent is running and your keys are added (ssh-add -l)'
          );
        }
        connectConfig.agent = agentSocket;
        break;
      }

      default: {
        throw new Error(`Unsupported authentication type: ${config.authType}`);
      }
    }

    return connectConfig;
  }

  /**
   * Establishes a GSSAPI/Kerberos SSH connection using system ssh with ControlMaster.
   * Since the ssh2 library doesn't support GSSAPI authentication, we use the system's
   * OpenSSH client which has native Kerberos support.
   */
  private async connectGssapi(connectionId: string, config: SshConfig): Promise<string> {
    const socketPath = join(tmpdir(), `emdash-ssh-${connectionId}`);

    // Clean up any stale socket file
    try {
      await unlink(socketPath);
    } catch {
      // Ignore if doesn't exist
    }

    const sshArgs = [
      '-f', // Go to background after auth
      '-N', // No remote command
      '-M', // ControlMaster mode
      '-S',
      socketPath,
      '-o',
      'GSSAPIAuthentication=yes',
      '-o',
      'GSSAPIDelegateCredentials=yes',
      '-o',
      'PreferredAuthentications=gssapi-with-mic,gssapi-keyex',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=15',
      '-p',
      String(config.port),
      '-l',
      config.username,
      config.host,
    ];

    return new Promise<string>((resolve, reject) => {
      const proc = spawn('ssh', sshArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Ensure Kerberos ticket cache is available
          KRB5CCNAME: process.env.KRB5CCNAME || '',
        },
      });

      let stderr = '';
      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // ssh -f will exit after backgrounding if auth succeeds.
      // If it exits with code 0, the ControlMaster is running.
      proc.on('close', (code) => {
        if (code === 0) {
          const gssapiConn: GssapiConnection = {
            id: connectionId,
            config,
            controlSocketPath: socketPath,
            connectedAt: new Date(),
            lastActivity: new Date(),
          };
          this.gssapiConnections.set(connectionId, gssapiConn);
          this.emit('connected', connectionId);
          resolve(connectionId);
        } else {
          const errorMsg = stderr.trim() || `SSH GSSAPI authentication failed (exit code ${code})`;
          reject(new Error(errorMsg));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn ssh: ${err.message}`));
      });

      // Store reference for cleanup
      this.gssapiProcesses.set(connectionId, proc);
    });
  }

  /**
   * Checks if a connection is using GSSAPI/Kerberos authentication.
   */
  isGssapiConnection(connectionId: string): boolean {
    return this.gssapiConnections.has(connectionId);
  }

  /**
   * Gets the GSSAPI connection info (including ControlMaster socket path).
   */
  getGssapiConnection(connectionId: string): GssapiConnection | undefined {
    return this.gssapiConnections.get(connectionId);
  }

  /**
   * Builds SSH args for GSSAPI ControlMaster connection reuse.
   */
  getGssapiSshArgs(connectionId: string): string[] | undefined {
    const conn = this.gssapiConnections.get(connectionId);
    if (!conn) return undefined;
    return [
      '-S',
      conn.controlSocketPath,
      '-o',
      'ControlMaster=no',
      '-p',
      String(conn.config.port),
      '-l',
      conn.config.username,
      conn.config.host,
    ];
  }

  /**
   * Executes a command on a GSSAPI connection using the ControlMaster socket.
   */
  private executeCommandGssapi(
    conn: GssapiConnection,
    command: string,
    cwd?: string
  ): Promise<ExecResult> {
    const innerCommand = cwd ? `cd ${quoteShellArg(cwd)} && ${command}` : command;
    const fullCommand = `bash -l -c ${quoteShellArg(innerCommand)}`;

    return new Promise((resolve, reject) => {
      execFile(
        'ssh',
        [
          '-S',
          conn.controlSocketPath,
          '-o',
          'ControlMaster=no',
          '-p',
          String(conn.config.port),
          '-l',
          conn.config.username,
          conn.config.host,
          fullCommand,
        ],
        { timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err && 'code' in err && typeof (err as any).code === 'number') {
            // Command exited with non-zero code, still a valid result
            resolve({
              stdout: (stdout || '').trim(),
              stderr: (stderr || '').trim(),
              exitCode: (err as any).code as number,
            });
          } else if (err) {
            reject(err);
          } else {
            resolve({
              stdout: (stdout || '').trim(),
              stderr: (stderr || '').trim(),
              exitCode: 0,
            });
          }
        }
      );
    });
  }

  /**
   * Disconnects a GSSAPI connection by terminating the ControlMaster.
   */
  private async disconnectGssapi(connectionId: string): Promise<void> {
    const conn = this.gssapiConnections.get(connectionId);
    if (!conn) return;

    // Send exit command to ControlMaster
    try {
      await new Promise<void>((resolve) => {
        execFile(
          'ssh',
          ['-S', conn.controlSocketPath, '-O', 'exit', conn.config.host],
          { timeout: 5000 },
          () => resolve() // Ignore errors, best-effort
        );
      });
    } catch {
      // Best-effort cleanup
    }

    // Clean up socket file
    try {
      await unlink(conn.controlSocketPath);
    } catch {
      // Ignore
    }

    // Kill any lingering process
    const proc = this.gssapiProcesses.get(connectionId);
    if (proc && !proc.killed) {
      proc.kill();
    }

    this.gssapiProcesses.delete(connectionId);
    this.gssapiConnections.delete(connectionId);
    this.emit('disconnected', connectionId);
  }

  /**
   * Disconnects an existing SSH connection.
   * @param connectionId - ID of the connection to close
   */
  async disconnect(connectionId: string): Promise<void> {
    // Handle GSSAPI connections
    if (this.gssapiConnections.has(connectionId)) {
      return this.disconnectGssapi(connectionId);
    }

    const connection = this.connections[connectionId];
    if (!connection) {
      return; // Already disconnected or never existed
    }

    // Close SFTP session if open, waiting for close to complete
    if (connection.sftp) {
      try {
        await new Promise<void>((resolve) => {
          const sftp = connection.sftp!;
          const timeout = setTimeout(() => resolve(), 2000); // 2s safety timeout
          sftp.once('close', () => {
            clearTimeout(timeout);
            resolve();
          });
          sftp.end();
        });
      } catch {
        // Ignore errors during SFTP close
      }
      connection.sftp = undefined;
    }

    // Close SSH client
    connection.client.end();

    // Remove from pool
    delete this.connections[connectionId];

    // Emit disconnected event
    this.emit('disconnected', connectionId);
  }

  /**
   * Executes a command on the remote host.
   * @param connectionId - ID of the active connection
   * @param command - Command to execute
   * @param cwd - Optional working directory
   * @returns Command execution result
   */
  async executeCommand(connectionId: string, command: string, cwd?: string): Promise<ExecResult> {
    // Handle GSSAPI connections
    const gssapiConn = this.gssapiConnections.get(connectionId);
    if (gssapiConn) {
      gssapiConn.lastActivity = new Date();
      return this.executeCommandGssapi(gssapiConn, command, cwd);
    }

    const connection = this.connections[connectionId];
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    // Update last activity
    connection.lastActivity = new Date();

    // Build the command with optional cwd, wrapped in a login shell so that
    // ~/.ssh/config, ~/.gitconfig, and other user-level configuration files
    // are available (ssh2's client.exec() uses a non-login shell by default).
    const innerCommand = cwd ? `cd ${quoteShellArg(cwd)} && ${command}` : command;
    const fullCommand = `bash -l -c ${quoteShellArg(innerCommand)}`;

    return new Promise((resolve, reject) => {
      connection.client.exec(fullCommand, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';
        stream.on('close', (code: number | null) => {
          // ssh2 reports `code` as null when a signal terminates the process.
          // Keep ExecResult.exitCode as a number for simpler downstream typing.
          const exitCode = code ?? -1;
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode,
          });
        });

        stream.on('data', (data: Buffer) => {
          stdout += data.toString('utf-8');
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString('utf-8');
        });

        stream.on('error', (streamErr: Error) => {
          reject(streamErr);
        });
      });
    });
  }

  /**
   * Gets an SFTP session for file operations.
   * @param connectionId - ID of the active connection
   * @returns SFTP wrapper instance
   */
  async getSftp(connectionId: string): Promise<SFTPWrapper> {
    if (this.gssapiConnections.has(connectionId)) {
      throw new Error(
        'SFTP is not available for GSSAPI connections. Use executeCommand-based file operations instead.'
      );
    }

    const connection = this.connections[connectionId];
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    // Return cached SFTP if available
    if (connection.sftp) {
      connection.lastActivity = new Date();
      return connection.sftp;
    }

    // Create new SFTP session
    return new Promise((resolve, reject) => {
      connection.client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }

        connection.sftp = sftp;
        connection.lastActivity = new Date();
        resolve(sftp);
      });
    });
  }

  /**
   * Gets connection info for a specific connection.
   * @param connectionId - ID of the connection
   * @returns Connection object or undefined if not found
   */
  getConnection(connectionId: string): Connection | undefined {
    return this.connections[connectionId];
  }

  /**
   * Gets all active connections.
   * @returns Array of connection objects
   */
  getAllConnections(): Connection[] {
    return Object.values(this.connections);
  }

  /**
   * Checks if a connection is currently connected.
   * @param connectionId - ID of the connection
   * @returns True if connected
   */
  isConnected(connectionId: string): boolean {
    return connectionId in this.connections || this.gssapiConnections.has(connectionId);
  }

  /**
   * Lists all active connection IDs.
   * @returns Array of connection IDs
   */
  listConnections(): string[] {
    return [...Object.keys(this.connections), ...this.gssapiConnections.keys()];
  }

  /**
   * Gets connection info for a specific connection.
   * @param connectionId - ID of the connection
   */
  getConnectionInfo(connectionId: string): { connectedAt: Date; lastActivity: Date } | null {
    const conn = this.connections[connectionId];
    if (conn) {
      return { connectedAt: conn.connectedAt, lastActivity: conn.lastActivity };
    }
    const gssapiConn = this.gssapiConnections.get(connectionId);
    if (gssapiConn) {
      return { connectedAt: gssapiConn.connectedAt, lastActivity: gssapiConn.lastActivity };
    }
    return null;
  }

  /**
   * Disconnects all active connections.
   * Useful for cleanup on shutdown.
   */
  async disconnectAll(): Promise<void> {
    const allIds = [...Object.keys(this.connections), ...this.gssapiConnections.keys()];
    const disconnectPromises = allIds.map((id) =>
      this.disconnect(id).catch(() => {
        // Ignore errors during bulk disconnect
      })
    );
    await Promise.all(disconnectPromises);
  }
}

/** Module-level singleton — all main-process code should import this. */
export const sshService = new SshService();
