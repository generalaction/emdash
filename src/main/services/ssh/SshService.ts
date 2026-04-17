import { EventEmitter } from 'events';
import { Client, SFTPWrapper, ConnectConfig } from 'ssh2';
import { SshConfig, ExecResult } from '../../../shared/ssh/types';
import { Connection, ConnectionPool } from './types';
import { SshCredentialService } from './SshCredentialService';
import { quoteShellArg } from '../../utils/shellEscape';
import { readFile } from 'fs/promises';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { spawn, ChildProcess } from 'child_process';

const execFileAsync = promisify(execFileCb);
import {
  resolveIdentityAgent,
  resolveSshConfigHost,
  resolveProxyCommand,
} from '../../utils/sshConfigParser';

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
  private pendingConnections: Map<string, Promise<string>> = new Map();
  private proxyProcesses: Map<string, ChildProcess> = new Map();
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
    if (this.connections[connectionId]) {
      return connectionId;
    }

    // 2. If a connection attempt is already in flight, coalesce
    const pending = this.pendingConnections.get(connectionId);
    if (pending) {
      return pending;
    }

    // 3. Enforce connection pool limit
    const poolSize = Object.keys(this.connections).length + this.pendingConnections.size;
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

    // 4. Create the connection and track the in-flight promise
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
        // Clean up any proxy process for this failed connection
        const proxyProc = this.proxyProcesses.get(connectionId);
        if (proxyProc) {
          try {
            proxyProc.kill();
          } catch {
            /* ignore */
          }
          this.proxyProcesses.delete(connectionId);
        }
        reject(err);
      });

      // Handle connection close
      client.on('close', () => {
        // Only clean up if this client is still the one stored in the pool.
        // A stale client's close event must not remove a newer connection
        // that was established under the same connectionId.
        if (this.connections[connectionId]?.client === client) {
          delete this.connections[connectionId];
          const proxyProc = this.proxyProcesses.get(connectionId);
          if (proxyProc) {
            try {
              proxyProc.kill();
            } catch {
              /* ignore */
            }
            this.proxyProcesses.delete(connectionId);
          }
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
          // Track proxy process for cleanup on disconnect
          const proxyProc = (connectConfig as any)._proxyProcess as ChildProcess | undefined;
          if (proxyProc) {
            this.proxyProcesses.set(connectionId, proxyProc);
            delete (connectConfig as any)._proxyProcess;
          }
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
   * Builds the ssh2 ConnectConfig from our SshConfig.
   *
   * ssh2 does not read ~/.ssh/config, so we resolve the host through
   * sshConfigParser first. This enables SSH aliases (e.g.
   * "my-remote-host") to resolve to their actual HostName, Port,
   * User, and IdentityFile as defined in the user's SSH config.
   */
  private async buildConnectConfig(
    connectionId: string,
    config: SshConfig
  ): Promise<ConnectConfig> {
    // Resolve SSH config overrides for this host/alias
    const sshConfigEntry = await resolveSshConfigHost(config.host);

    const connectConfig: ConnectConfig = {
      // Use resolved HostName if available, otherwise the original host
      host: sshConfigEntry?.hostname ?? config.host,
      port: config.port ?? sshConfigEntry?.port ?? 22,
      username: config.username ?? sshConfigEntry?.user,
      readyTimeout: 20000,
      keepaliveInterval: 60000,
      keepaliveCountMax: 3,
    };

    // Check for ProxyCommand in ~/.ssh/config
    const proxyCommand = await resolveProxyCommand(config.host, config.port);
    if (proxyCommand) {
      const { Duplex } = await import('stream');
      const proxyProc = spawn('sh', ['-c', proxyCommand], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Create a duplex stream bridging proxy stdout (read) and stdin (write)
      const sock = new Duplex({
        read() {},
        write(chunk, encoding, callback) {
          return proxyProc.stdin!.write(chunk, encoding, callback);
        },
        final(callback) {
          proxyProc.stdin!.end(callback);
        },
      });
      proxyProc.stdout!.on('data', (data) => sock.push(data));
      proxyProc.stdout!.on('close', () => sock.push(null));
      proxyProc.on('error', (err) => sock.destroy(err));

      (connectConfig as any).sock = sock;
      (connectConfig as any)._proxyProcess = proxyProc;
    }

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
        // Prefer the already-resolved config entry to avoid re-parsing ~/.ssh/config
        const identityAgent =
          sshConfigEntry?.identityAgent ?? (await resolveIdentityAgent(config.host));
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
   * Disconnects an existing SSH connection.
   * @param connectionId - ID of the connection to close
   */
  async disconnect(connectionId: string): Promise<void> {
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

    // Kill proxy process if one was used
    const proxyProc = this.proxyProcesses.get(connectionId);
    if (proxyProc) {
      try {
        proxyProc.kill();
      } catch {
        /* ignore */
      }
      this.proxyProcesses.delete(connectionId);
    }

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
    const connection = this.connections[connectionId];
    if (!connection) {
      // Fallback: execute via SSH CLI binary for connections not in the ssh2 pool
      // (e.g. workspace-provisioned connections that were never ssh2-connected).
      return this.executeCommandViaCli(connectionId, command, cwd);
    }

    // Update last activity
    connection.lastActivity = new Date();

    // Build the command with optional cwd, wrapped in a login shell so that
    // ~/.ssh/config, ~/.gitconfig, and other user-level configuration files
    // are available (ssh2's client.exec() uses a non-login shell by default).
    const safeCwd = cwd ? cwd.replace(/\\/g, '/') : undefined;
    const innerCommand = safeCwd ? `cd ${quoteShellArg(safeCwd)} && ${command}` : command;

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
   * Fallback: execute a command via the system SSH CLI binary.
   * Used for connections that exist in the DB but aren't in the ssh2 pool
   * (e.g. workspace-provisioned connections).
   */
  private async executeCommandViaCli(
    connectionId: string,
    command: string,
    cwd?: string
  ): Promise<ExecResult> {
    const { getDrizzleClient } = await import('../../db/drizzleClient');
    const { sshConnections } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');

    const { db } = await getDrizzleClient();
    const rows = await db
      .select({
        host: sshConnections.host,
        port: sshConnections.port,
        username: sshConnections.username,
        privateKeyPath: sshConnections.privateKeyPath,
      })
      .from(sshConnections)
      .where(eq(sshConnections.id, connectionId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    const sshArgs: string[] = ['-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes'];
    if (row.port && row.port !== 22) {
      sshArgs.push('-p', String(row.port));
    }
    if (row.privateKeyPath) {
      sshArgs.push('-i', row.privateKeyPath);
    }

    const target = row.username ? `${row.username}@${row.host}` : row.host;

    const safeCwd = cwd ? cwd.replace(/\\/g, '/') : undefined;
    const innerCommand = safeCwd ? `cd ${quoteShellArg(safeCwd)} && ${command}` : command;

    const fullCommand = `bash -l -c ${quoteShellArg(innerCommand)}`;

    try {
      const { stdout, stderr } = await execFileAsync('ssh', [...sshArgs, target, fullCommand], {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
      });
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: (err.stdout ?? '').trim(),
        stderr: (err.stderr ?? '').trim(),
        exitCode: err.code ?? 1,
      };
    }
  }

  /**
   * Gets an SFTP session for file operations.
   * @param connectionId - ID of the active connection
   * @returns SFTP wrapper instance
   */
  async getSftp(connectionId: string): Promise<SFTPWrapper> {
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
    return connectionId in this.connections;
  }

  /**
   * Lists all active connection IDs.
   * @returns Array of connection IDs
   */
  listConnections(): string[] {
    return Object.keys(this.connections);
  }

  /**
   * Gets connection info for a specific connection.
   * @param connectionId - ID of the connection
   */
  getConnectionInfo(connectionId: string): { connectedAt: Date; lastActivity: Date } | null {
    const conn = this.connections[connectionId];
    if (!conn) return null;
    return {
      connectedAt: conn.connectedAt,
      lastActivity: conn.lastActivity,
    };
  }

  /**
   * Disconnects all active connections.
   * Useful for cleanup on shutdown.
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises = Object.keys(this.connections).map((id) =>
      this.disconnect(id).catch(() => {
        // Ignore errors during bulk disconnect
      })
    );
    await Promise.all(disconnectPromises);
  }
}

/** Module-level singleton — all main-process code should import this. */
export const sshService = new SshService();
