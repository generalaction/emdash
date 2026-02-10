import { ipcMain } from 'electron';
import { SSH_IPC_CHANNELS } from '../../shared/ssh/types';
import { SshService } from '../services/ssh/SshService';
import { SshCredentialService } from '../services/ssh/SshCredentialService';
import { SshHostKeyService } from '../services/ssh/SshHostKeyService';
import { SshConnectionMonitor } from '../services/ssh/SshConnectionMonitor';
import { getDrizzleClient } from '../db/drizzleClient';
import { sshConnections as sshConnectionsTable, type SshConnectionInsert } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type {
  SshConfig,
  ConnectionTestResult,
  FileEntry,
  ConnectionState,
  SshConfigHost,
} from '../../shared/ssh/types';

// Initialize services
// Exported so other main-process IPC handlers can reuse the same connection pool.
export const sshService = new SshService();
const credentialService = new SshCredentialService();
// Host key service initialized for future use (host key verification)
const _hostKeyService = new SshHostKeyService();
const monitor = new SshConnectionMonitor();

/**
 * Maps a database row to SshConfig
 */
function mapRowToConfig(row: {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: string;
  privateKeyPath: string | null;
  useAgent: number;
}): SshConfig {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.authType as 'password' | 'key' | 'agent',
    privateKeyPath: row.privateKeyPath ?? undefined,
    useAgent: row.useAgent === 1,
  };
}

/**
 * Validates that a remote path is safe to access.
 *
 * Uses a two-layer approach:
 *   1. Reject any path containing traversal sequences (even after normalization).
 *   2. Reject paths that resolve into known-sensitive directories.
 *
 * The path is resolved against '/' so that relative tricks like
 * "foo/../../etc/shadow" are caught.
 */
function isPathSafe(remotePath: string): boolean {
  // Must be an absolute path
  if (!remotePath.startsWith('/')) {
    return false;
  }

  // Normalize repeated slashes
  const normalized = remotePath.replace(/\/+/g, '/');

  // Reject any occurrence of '..' as a path component
  // This catches ../  /..  and trailing /..
  const segments = normalized.split('/');
  if (segments.some((s) => s === '..')) {
    return false;
  }

  // Block access to sensitive system directories and hidden dotfiles
  const restrictedPrefixes = ['/etc/', '/proc/', '/sys/', '/dev/', '/boot/', '/root/'];
  for (const prefix of restrictedPrefixes) {
    if (normalized.startsWith(prefix) || normalized === prefix.slice(0, -1)) {
      return false;
    }
  }

  // Block .ssh directories anywhere in the path
  if (segments.some((s) => s === '.ssh')) {
    return false;
  }

  return true;
}

/**
 * Register all SSH IPC handlers
 */
export function registerSshIpc() {
  // Wire up reconnect handler so the monitor's reconnect event actually reconnects (HIGH #9)
  monitor.on('reconnect', async (connectionId: string, config: SshConfig, attempt: number) => {
    try {
      console.log(`[sshIpc] Reconnecting ${connectionId} (attempt ${attempt})...`);
      await sshService.connect(config);
      monitor.updateState(connectionId, 'connected');
    } catch (err: any) {
      console.error(
        `[sshIpc] Reconnect attempt ${attempt} failed for ${connectionId}:`,
        err.message
      );
      monitor.updateState(connectionId, 'error', err.message);
    }
  });
  // Test connection
  ipcMain.handle(
    SSH_IPC_CHANNELS.TEST_CONNECTION,
    async (
      _,
      config: SshConfig & { password?: string; passphrase?: string }
    ): Promise<ConnectionTestResult> => {
      try {
        const { Client } = await import('ssh2');
        const testClient = new Client();

        return new Promise((resolve) => {
          const startTime = Date.now();

          testClient.on('ready', () => {
            const latency = Date.now() - startTime;
            testClient.end();
            resolve({ success: true, latency });
          });

          testClient.on('error', (err: Error) => {
            resolve({ success: false, error: err.message });
          });

          testClient.on('keyboard-interactive', () => {
            // Close the connection if keyboard-interactive auth is required
            testClient.end();
            resolve({ success: false, error: 'Keyboard-interactive authentication not supported' });
          });

          const connectConfig: {
            host: string;
            port: number;
            username: string;
            readyTimeout: number;
            password?: string;
            privateKey?: Buffer;
            passphrase?: string;
            agent?: string;
          } = {
            host: config.host,
            port: config.port,
            username: config.username,
            readyTimeout: 10000,
          };

          if (config.authType === 'password') {
            connectConfig.password = config.password;
          } else if (config.authType === 'key' && config.privateKeyPath) {
            const fs = require('fs');
            const os = require('os');
            try {
              // Expand ~ to home directory
              let keyPath = config.privateKeyPath;
              if (keyPath.startsWith('~/')) {
                keyPath = keyPath.replace('~', os.homedir());
              } else if (keyPath === '~') {
                keyPath = os.homedir();
              }

              connectConfig.privateKey = fs.readFileSync(keyPath);
              if (config.passphrase) {
                connectConfig.passphrase = config.passphrase;
              }
            } catch (err: any) {
              resolve({ success: false, error: `Failed to read private key: ${err.message}` });
              return;
            }
          } else if (config.authType === 'agent') {
            connectConfig.agent = process.env.SSH_AUTH_SOCK;
          }

          testClient.connect(connectConfig);
        });
      } catch (err: any) {
        console.error('[sshIpc] Test connection error:', err);
        return { success: false, error: err.message };
      }
    }
  );

  // Save connection
  ipcMain.handle(
    SSH_IPC_CHANNELS.SAVE_CONNECTION,
    async (
      _,
      config: SshConfig & { password?: string; passphrase?: string }
    ): Promise<{ success: boolean; connection?: SshConfig; error?: string }> => {
      try {
        const { db } = await getDrizzleClient();

        // Generate ID if not provided
        const connectionId =
          config.id ?? `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Save credentials first (secure keychain storage)
        if (config.password) {
          await credentialService.storePassword(connectionId, config.password);
        }
        if (config.passphrase) {
          await credentialService.storePassphrase(connectionId, config.passphrase);
        }

        // Strip sensitive data before saving to DB
        const { password: _password, passphrase: _passphrase, ...dbConfig } = config;

        const insertData: SshConnectionInsert = {
          id: connectionId,
          name: dbConfig.name,
          host: dbConfig.host,
          port: dbConfig.port,
          username: dbConfig.username,
          authType: dbConfig.authType,
          privateKeyPath: dbConfig.privateKeyPath,
          useAgent: dbConfig.useAgent ? 1 : 0,
        };

        // Insert or update
        await db
          .insert(sshConnectionsTable)
          .values(insertData)
          .onConflictDoUpdate({
            target: sshConnectionsTable.id,
            set: {
              name: insertData.name,
              host: insertData.host,
              port: insertData.port,
              username: insertData.username,
              authType: insertData.authType,
              privateKeyPath: insertData.privateKeyPath,
              useAgent: insertData.useAgent,
              updatedAt: new Date().toISOString(),
            },
          });

        return {
          success: true,
          connection: {
            ...dbConfig,
            id: connectionId,
          },
        };
      } catch (err: any) {
        console.error('[sshIpc] Save connection error:', err);
        return { success: false, error: err.message };
      }
    }
  );

  // Get connections
  ipcMain.handle(
    SSH_IPC_CHANNELS.GET_CONNECTIONS,
    async (): Promise<{ success: boolean; connections?: SshConfig[]; error?: string }> => {
      try {
        const { db } = await getDrizzleClient();

        const rows = await db
          .select({
            id: sshConnectionsTable.id,
            name: sshConnectionsTable.name,
            host: sshConnectionsTable.host,
            port: sshConnectionsTable.port,
            username: sshConnectionsTable.username,
            authType: sshConnectionsTable.authType,
            privateKeyPath: sshConnectionsTable.privateKeyPath,
            useAgent: sshConnectionsTable.useAgent,
          })
          .from(sshConnectionsTable)
          .orderBy(desc(sshConnectionsTable.updatedAt));

        return {
          success: true,
          connections: rows.map(mapRowToConfig),
        };
      } catch (err: any) {
        console.error('[sshIpc] Get connections error:', err);
        return { success: false, error: err.message };
      }
    }
  );

  // Delete connection
  ipcMain.handle(
    SSH_IPC_CHANNELS.DELETE_CONNECTION,
    async (_, id: string): Promise<{ success: boolean; error?: string }> => {
      try {
        // Disconnect active connection first to avoid orphaned sessions (HIGH #8)
        if (sshService.isConnected(id)) {
          try {
            await sshService.disconnect(id);
            monitor.stopMonitoring(id);
          } catch {
            // Best-effort: continue with deletion even if disconnect fails
          }
        }

        const { db } = await getDrizzleClient();

        // Delete credentials
        await credentialService.deleteAllCredentials(id);

        // Delete from database
        await db.delete(sshConnectionsTable).where(eq(sshConnectionsTable.id, id));

        return { success: true };
      } catch (err: any) {
        console.error('[sshIpc] Delete connection error:', err);
        return { success: false, error: err.message };
      }
    }
  );

  // Connect
  ipcMain.handle(
    SSH_IPC_CHANNELS.CONNECT,
    async (
      _,
      arg: unknown
    ): Promise<{ success: boolean; connectionId?: string; error?: string }> => {
      try {
        // Accept either a saved connection id (string) or a config object.
        if (typeof arg === 'string') {
          const id = arg;
          const { db } = await getDrizzleClient();
          const rows = await db
            .select({
              id: sshConnectionsTable.id,
              name: sshConnectionsTable.name,
              host: sshConnectionsTable.host,
              port: sshConnectionsTable.port,
              username: sshConnectionsTable.username,
              authType: sshConnectionsTable.authType,
              privateKeyPath: sshConnectionsTable.privateKeyPath,
              useAgent: sshConnectionsTable.useAgent,
            })
            .from(sshConnectionsTable)
            .where(eq(sshConnectionsTable.id, id))
            .limit(1);

          const row = rows[0];
          if (!row) {
            return { success: false, error: `SSH connection not found: ${id}` };
          }

          const loadedConfig = mapRowToConfig(row);
          const connectionId = await sshService.connect(loadedConfig);
          monitor.startMonitoring(connectionId, loadedConfig);
          return { success: true, connectionId };
        }

        if (!arg || typeof arg !== 'object') {
          return { success: false, error: 'Invalid SSH connect request' };
        }

        const config = arg as SshConfig & { password?: string; passphrase?: string };
        const effectiveId = config.id ?? randomUUID();

        // If secrets are provided inline, store them for this id.
        if (config.authType === 'password' && typeof config.password === 'string') {
          await credentialService.storePassword(effectiveId, config.password);
        }
        if (
          config.authType === 'key' &&
          typeof config.passphrase === 'string' &&
          config.passphrase
        ) {
          await credentialService.storePassphrase(effectiveId, config.passphrase);
        }

        // Load credentials from keychain if needed
        let password = config.password;
        let passphrase = config.passphrase;

        if (config.authType === 'password' && !password) {
          password = (await credentialService.getPassword(effectiveId)) ?? undefined;
        }
        if (config.authType === 'key' && !passphrase) {
          passphrase = (await credentialService.getPassphrase(effectiveId)) ?? undefined;
        }

        const fullConfig = {
          ...config,
          id: effectiveId,
          password,
          passphrase,
        };

        const connectionId = await sshService.connect(fullConfig as any);
        monitor.startMonitoring(connectionId, fullConfig as any);
        return { success: true, connectionId };
      } catch (err: any) {
        console.error('[sshIpc] Connection error:', err);
        return { success: false, error: err.message };
      }
    }
  );

  // Disconnect
  ipcMain.handle(
    SSH_IPC_CHANNELS.DISCONNECT,
    async (_, connectionId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        await sshService.disconnect(connectionId);
        monitor.stopMonitoring(connectionId);
        return { success: true };
      } catch (err: any) {
        console.error('[sshIpc] Disconnect error:', err);
        return { success: false, error: err.message };
      }
    }
  );

  // Execute command
  ipcMain.handle(
    SSH_IPC_CHANNELS.EXECUTE_COMMAND,
    async (
      _,
      connectionId: string,
      command: string,
      cwd?: string
    ): Promise<{
      success: boolean;
      stdout?: string;
      stderr?: string;
      exitCode?: number;
      error?: string;
    }> => {
      try {
        const result = await sshService.executeCommand(connectionId, command, cwd);
        return { success: true, ...result };
      } catch (error: any) {
        console.error('[sshIpc] Execute command error:', error);
        return { success: false, error: error.message };
      }
    }
  );

  // List files
  ipcMain.handle(
    SSH_IPC_CHANNELS.LIST_FILES,
    async (
      _,
      connectionId: string,
      path: string
    ): Promise<{ success: boolean; files?: FileEntry[]; error?: string }> => {
      try {
        const sftp = await sshService.getSftp(connectionId);

        return new Promise((resolve) => {
          sftp.readdir(path, (err, list) => {
            if (err) {
              resolve({ success: false, error: `Failed to list files: ${err.message}` });
              return;
            }

            const entries: FileEntry[] = list.map((item) => {
              const isDirectory = item.attrs.isDirectory();
              const isSymlink = item.attrs.isSymbolicLink();

              let type: 'file' | 'directory' | 'symlink' = 'file';
              if (isDirectory) type = 'directory';
              else if (isSymlink) type = 'symlink';

              return {
                path: `${path}/${item.filename}`.replace(/\/+/g, '/'),
                name: item.filename,
                type,
                size: item.attrs.size,
                modifiedAt: new Date(item.attrs.mtime * 1000),
                permissions: item.attrs.mode?.toString(8),
              };
            });

            resolve({ success: true, files: entries });
          });
        });
      } catch (error: any) {
        console.error('[sshIpc] List files error:', error);
        return { success: false, error: error.message };
      }
    }
  );

  // Read file
  ipcMain.handle(
    SSH_IPC_CHANNELS.READ_FILE,
    async (
      _,
      connectionId: string,
      path: string
    ): Promise<{ success: boolean; content?: string; error?: string }> => {
      try {
        // Validate path to prevent access to sensitive files
        if (!isPathSafe(path)) {
          return { success: false, error: 'Access denied: path is restricted' };
        }

        const sftp = await sshService.getSftp(connectionId);

        return new Promise((resolve) => {
          sftp.readFile(path, 'utf-8', (err, data) => {
            if (err) {
              resolve({ success: false, error: `Failed to read file: ${err.message}` });
              return;
            }
            resolve({ success: true, content: data.toString() });
          });
        });
      } catch (error: any) {
        console.error('[sshIpc] Read file error:', error);
        return { success: false, error: error.message };
      }
    }
  );

  // Write file
  ipcMain.handle(
    SSH_IPC_CHANNELS.WRITE_FILE,
    async (
      _,
      connectionId: string,
      path: string,
      content: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        // Validate path to prevent writing to sensitive files
        if (!isPathSafe(path)) {
          return { success: false, error: 'Access denied: path is restricted' };
        }

        const sftp = await sshService.getSftp(connectionId);

        return new Promise((resolve) => {
          sftp.writeFile(path, content, 'utf-8', (err) => {
            if (err) {
              resolve({ success: false, error: `Failed to write file: ${err.message}` });
              return;
            }
            resolve({ success: true });
          });
        });
      } catch (error: any) {
        console.error('[sshIpc] Write file error:', error);
        return { success: false, error: error.message };
      }
    }
  );

  // Get state
  ipcMain.handle(
    SSH_IPC_CHANNELS.GET_STATE,
    async (
      _,
      connectionId: string
    ): Promise<{ success: boolean; state?: ConnectionState; error?: string }> => {
      try {
        const state = monitor.getState(connectionId);
        return { success: true, state };
      } catch (err: any) {
        console.error('[sshIpc] Get state error:', err);
        return { success: false, error: err.message };
      }
    }
  );

  // Helper function to parse SSH config
  const parseSshConfigFile = async (): Promise<SshConfigHost[]> => {
    const configPath = join(homedir(), '.ssh', 'config');
    const content = await readFile(configPath, 'utf-8').catch(() => '');

    const hosts: SshConfigHost[] = [];
    const lines = content.split('\n');
    let currentHost: SshConfigHost | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Match Host directive
      const hostMatch = trimmed.match(/^Host\s+(.+)$/i);
      if (hostMatch) {
        // Save previous host if exists
        if (currentHost && currentHost.host) {
          hosts.push(currentHost);
        }
        // Start new host entry
        const hostPattern = hostMatch[1].trim();
        // Skip wildcard patterns
        if (!hostPattern.includes('*') && !hostPattern.includes('?')) {
          currentHost = { host: hostPattern };
        } else {
          currentHost = null;
        }
        continue;
      }

      // Match HostName
      const hostnameMatch = trimmed.match(/^HostName\s+(.+)$/i);
      if (hostnameMatch && currentHost) {
        currentHost.hostname = hostnameMatch[1].trim();
        continue;
      }

      // Match User
      const userMatch = trimmed.match(/^User\s+(.+)$/i);
      if (userMatch && currentHost) {
        currentHost.user = userMatch[1].trim();
        continue;
      }

      // Match Port
      const portMatch = trimmed.match(/^Port\s+(\d+)$/i);
      if (portMatch && currentHost) {
        currentHost.port = parseInt(portMatch[1], 10);
        continue;
      }

      // Match IdentityFile
      const identityMatch = trimmed.match(/^IdentityFile\s+(.+)$/i);
      if (identityMatch && currentHost) {
        let identityFile = identityMatch[1].trim();
        // Strip optional quotes
        if (
          (identityFile.startsWith('"') && identityFile.endsWith('"')) ||
          (identityFile.startsWith("'") && identityFile.endsWith("'"))
        ) {
          identityFile = identityFile.slice(1, -1);
        }
        // Expand ~ to home directory
        if (identityFile === '~') {
          identityFile = homedir();
        } else if (identityFile.startsWith('~/')) {
          identityFile = join(homedir(), identityFile.slice(2));
        }
        currentHost.identityFile = identityFile;
        continue;
      }
    }

    // Don't forget the last host
    if (currentHost && currentHost.host) {
      hosts.push(currentHost);
    }

    return hosts;
  };

  // Get SSH config hosts from ~/.ssh/config
  ipcMain.handle(
    SSH_IPC_CHANNELS.GET_SSH_CONFIG,
    async (): Promise<{ success: boolean; hosts?: SshConfigHost[]; error?: string }> => {
      try {
        const hosts = await parseSshConfigFile();
        return { success: true, hosts };
      } catch (err: any) {
        console.error('[sshIpc] Get SSH config error:', err);
        return { success: false, error: err.message };
      }
    }
  );

  // Get a specific SSH config host by alias
  ipcMain.handle(
    SSH_IPC_CHANNELS.GET_SSH_CONFIG_HOST,
    async (
      _,
      hostAlias: string
    ): Promise<{ success: boolean; host?: SshConfigHost; error?: string }> => {
      try {
        if (!hostAlias || typeof hostAlias !== 'string') {
          return { success: false, error: 'Host alias is required' };
        }

        const hosts = await parseSshConfigFile();
        const host = hosts.find((h) => h.host.toLowerCase() === hostAlias.toLowerCase());

        if (!host) {
          return { success: false, error: `Host alias not found: ${hostAlias}` };
        }

        return { success: true, host };
      } catch (err: any) {
        console.error('[sshIpc] Get SSH config host error:', err);
        return { success: false, error: err.message };
      }
    }
  );
}
