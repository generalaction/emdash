import { ipcMain } from 'electron';
import { SSH_IPC_CHANNELS } from '../../shared/ssh/types';
import { sshService } from '../services/ssh/SshService';
import { SshCredentialService } from '../services/ssh/SshCredentialService';
import { SshHostKeyService } from '../services/ssh/SshHostKeyService';
import { SshConnectionMonitor } from '../services/ssh/SshConnectionMonitor';
import { getDrizzleClient } from '../db/drizzleClient';
import { sshConnections as sshConnectionsTable, type SshConnectionInsert } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { quoteShellArg } from '../utils/shellEscape';
import { parseSshConfigFile, resolveIdentityAgent } from '../utils/sshConfigParser';
import type {
  SshConfig,
  ConnectionTestResult,
  FileEntry,
  ConnectionState,
  SshConfigHost,
} from '../../shared/ssh/types';

// Initialize services
const credentialService = new SshCredentialService();
// Host key service initialized for future use (host key verification)
const _hostKeyService = new SshHostKeyService();
const monitor = new SshConnectionMonitor((id) => sshService.isConnected(id));

// When ssh2 detects a dead connection (via keepalive) and emits `close`,
// SshService removes it from the pool and emits `disconnected`.
// The monitor reacts by triggering reconnect with exponential backoff.
sshService.on('disconnected', (connectionId: string) => {
  monitor.handleDisconnect(connectionId);
});

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
 * Classify an SSH error into a safe, non-PII category for telemetry.
 */
function classifySshError(err: any): string {
  const msg = String(err?.message || err || '').toLowerCase();
  if (msg.includes('authentication') || msg.includes('auth') || msg.includes('password')) {
    return 'auth_failed';
  }
  if (msg.includes('timed out') || msg.includes('timeout')) {
    return 'timeout';
  }
  if (
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('enetunreach') ||
    msg.includes('network')
  ) {
    return 'network';
  }
  if (msg.includes('key') || msg.includes('passphrase') || msg.includes('decrypt')) {
    return 'key_error';
  }
  return 'unknown';
}

/**
 * Register all SSH IPC handlers
 */
export function registerSshIpc() {
  // Wire up reconnect handler so the monitor's reconnect event actually reconnects (HIGH #9)
  monitor.on('reconnect', async (connectionId: string, config: SshConfig, attempt: number) => {
    try {
      console.log(`[sshIpc] Reconnecting ${connectionId} (attempt ${attempt})...`);

      // Clean up the stale/dead connection before opening a new one
      if (sshService.isConnected(connectionId)) {
        await sshService.disconnect(connectionId).catch(() => {});
      }

      await sshService.connect(config);
      monitor.updateState(connectionId, 'connected');
      void import('../telemetry').then(({ capture }) => {
        void capture('ssh_reconnect_attempted', { success: true });
      });
    } catch (err: any) {
      console.error(
        `[sshIpc] Reconnect attempt ${attempt} failed for ${connectionId}:`,
        err.message
      );
      monitor.updateState(connectionId, 'error', err.message);
      void import('../telemetry').then(({ capture }) => {
        void capture('ssh_reconnect_attempted', { success: false });
      });
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
        const debugLogs: string[] = [];
        const testClient = new Client();

        return new Promise(async (resolve) => {
          const startTime = Date.now();

          testClient.on('ready', () => {
            const latency = Date.now() - startTime;
            testClient.end();
            resolve({ success: true, latency, debugLogs });
          });

          testClient.on('error', (err: Error) => {
            resolve({ success: false, error: err.message, debugLogs });
          });

          testClient.on('keyboard-interactive', () => {
            // Close the connection if keyboard-interactive auth is required
            testClient.end();
            resolve({
              success: false,
              error: 'Keyboard-interactive authentication not supported',
              debugLogs,
            });
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
            debug?: (info: string) => void;
          } = {
            host: config.host,
            port: config.port,
            username: config.username,
            readyTimeout: 10000,
            debug: (info: string) => debugLogs.push(info),
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
              resolve({
                success: false,
                error: `Failed to read private key: ${err.message}`,
                debugLogs,
              });
              return;
            }
          } else if (config.authType === 'agent') {
            const identityAgent = await resolveIdentityAgent(config.host);
            connectConfig.agent = identityAgent || process.env.SSH_AUTH_SOCK;
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

        void import('../telemetry').then(({ capture }) => {
          void capture('ssh_connection_saved', { type: config.authType });
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
        // Stop monitoring BEFORE disconnecting so the monitor's
        // handleDisconnect listener doesn't trigger a reconnect.
        monitor.stopMonitoring(id);
        if (sshService.isConnected(id)) {
          try {
            await sshService.disconnect(id);
          } catch {
            // Best-effort: continue with deletion even if disconnect fails
          }
        }

        const { db } = await getDrizzleClient();

        // Delete credentials
        await credentialService.deleteAllCredentials(id);

        // Delete from database
        await db.delete(sshConnectionsTable).where(eq(sshConnectionsTable.id, id));

        void import('../telemetry').then(({ capture }) => {
          void capture('ssh_connection_deleted');
        });

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
          // startMonitoring is a no-op if already tracked; updateState
          // is a no-op if not tracked. Call both to handle fresh connects
          // and re-connects after the monitor gave up (state = disconnected).
          monitor.startMonitoring(connectionId, loadedConfig);
          monitor.updateState(connectionId, 'connected');
          void import('../telemetry').then(({ capture }) => {
            void capture('ssh_connect_success', { type: loadedConfig.authType });
          });
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
        monitor.updateState(connectionId, 'connected');
        void import('../telemetry').then(({ capture }) => {
          void capture('ssh_connect_success', { type: config.authType });
        });
        return { success: true, connectionId };
      } catch (err: any) {
        console.error('[sshIpc] Connection error:', err);
        void import('../telemetry').then(({ capture }) => {
          void capture('ssh_connect_failed', { error_type: classifySshError(err) });
        });
        return { success: false, error: err.message };
      }
    }
  );

  // Disconnect
  ipcMain.handle(
    SSH_IPC_CHANNELS.DISCONNECT,
    async (_, connectionId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        // Stop monitoring BEFORE disconnecting so the monitor's
        // handleDisconnect listener doesn't trigger a reconnect
        // for an intentional disconnect.
        monitor.stopMonitoring(connectionId);
        await sshService.disconnect(connectionId);
        void import('../telemetry').then(({ capture }) => {
          void capture('ssh_disconnected');
        });
        return { success: true };
      } catch (err: any) {
        console.error('[sshIpc] Disconnect error:', err);
        return { success: false, error: err.message };
      }
    }
  );

  // Execute command (guarded: only allow known-safe command prefixes from renderer)
  const ALLOWED_COMMAND_PREFIXES = [
    'git ',
    'ls ',
    'pwd',
    'cat ',
    'head ',
    'tail ',
    'wc ',
    'stat ',
    'file ',
    'which ',
    'echo ',
    'test ',
    '[ ',
  ];

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
        // Validate the command against the allowlist
        const trimmed = command.trimStart();
        const isAllowed = ALLOWED_COMMAND_PREFIXES.some(
          (prefix) => trimmed === prefix.trimEnd() || trimmed.startsWith(prefix)
        );
        if (!isAllowed) {
          console.warn(`[sshIpc] Blocked disallowed command: ${trimmed.slice(0, 80)}`);
          return { success: false, error: 'Command not allowed' };
        }

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
        // Validate path to prevent browsing sensitive directories
        if (!isPathSafe(path)) {
          return { success: false, error: 'Access denied: path is restricted' };
        }

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

  // Check if a remote path is a git repository
  ipcMain.handle(
    SSH_IPC_CHANNELS.CHECK_IS_GIT_REPO,
    async (
      _,
      connectionId: string,
      remotePath: string
    ): Promise<{ success: boolean; isGitRepo?: boolean; error?: string }> => {
      try {
        if (!remotePath || !remotePath.startsWith('/')) {
          return { success: false, error: 'An absolute remote path is required' };
        }
        if (!isPathSafe(remotePath)) {
          return { success: false, error: 'Access denied: path is restricted' };
        }

        const result = await sshService.executeCommand(
          connectionId,
          `git -C ${quoteShellArg(remotePath)} rev-parse --is-inside-work-tree 2>/dev/null`
        );
        const isGitRepo = result.exitCode === 0 && result.stdout.trim() === 'true';
        return { success: true, isGitRepo };
      } catch (err: any) {
        console.error('[sshIpc] Check git repo error:', err);
        return { success: false, error: err.message };
      }
    }
  );

  // Initialize a new git repository on the remote machine
  ipcMain.handle(
    SSH_IPC_CHANNELS.INIT_REPO,
    async (
      _,
      connectionId: string,
      parentPath: string,
      repoName: string
    ): Promise<{ success: boolean; path?: string; error?: string }> => {
      try {
        if (!parentPath || !parentPath.startsWith('/')) {
          return { success: false, error: 'An absolute parent path is required' };
        }
        if (!isPathSafe(parentPath)) {
          return { success: false, error: 'Access denied: path is restricted' };
        }
        // Validate repo name: alphanumeric, hyphens, underscores, dots
        if (!repoName || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(repoName)) {
          return {
            success: false,
            error:
              'Invalid repository name. Use letters, numbers, hyphens, underscores, and dots. Must start with a letter or number.',
          };
        }

        const repoPath = `${parentPath.replace(/\/+$/, '')}/${repoName}`;
        if (!isPathSafe(repoPath)) {
          return { success: false, error: 'Access denied: target path is restricted' };
        }

        // Check if directory already exists
        const checkResult = await sshService.executeCommand(
          connectionId,
          `test -d ${quoteShellArg(repoPath)} && echo exists || echo absent`
        );
        if (checkResult.stdout.trim() === 'exists') {
          return { success: false, error: `Directory already exists: ${repoPath}` };
        }

        // Create directory and initialize git repo
        const initResult = await sshService.executeCommand(
          connectionId,
          `mkdir -p ${quoteShellArg(repoPath)} && git -C ${quoteShellArg(repoPath)} init`
        );
        if (initResult.exitCode !== 0) {
          return {
            success: false,
            error: `Failed to initialize repository: ${initResult.stderr || initResult.stdout}`,
          };
        }

        void import('../telemetry').then(({ capture }) => {
          void capture('ssh_repo_init');
        });

        return { success: true, path: repoPath };
      } catch (err: any) {
        console.error('[sshIpc] Init repo error:', err);
        return { success: false, error: err.message };
      }
    }
  );

  // Clone a repository on the remote machine
  ipcMain.handle(
    SSH_IPC_CHANNELS.CLONE_REPO,
    async (
      _,
      connectionId: string,
      repoUrl: string,
      targetPath: string
    ): Promise<{ success: boolean; path?: string; error?: string }> => {
      try {
        if (!repoUrl || typeof repoUrl !== 'string') {
          return { success: false, error: 'Repository URL is required' };
        }
        // Validate URL format
        const urlPatterns = [/^https?:\/\/.+/i, /^git@.+:.+/i, /^ssh:\/\/.+/i];
        if (!urlPatterns.some((p) => p.test(repoUrl.trim()))) {
          return {
            success: false,
            error: 'Invalid repository URL. Use https://, git@, or ssh:// format.',
          };
        }

        if (!targetPath || !targetPath.startsWith('/')) {
          return { success: false, error: 'An absolute target path is required' };
        }
        if (!isPathSafe(targetPath)) {
          return { success: false, error: 'Access denied: path is restricted' };
        }

        // Check if target already exists
        const checkResult = await sshService.executeCommand(
          connectionId,
          `test -e ${quoteShellArg(targetPath)} && echo exists || echo absent`
        );
        if (checkResult.stdout.trim() === 'exists') {
          return { success: false, error: `Target path already exists: ${targetPath}` };
        }

        // Ensure parent directory exists
        const parentDir = targetPath.replace(/\/[^/]+\/?$/, '') || '/';
        await sshService.executeCommand(connectionId, `mkdir -p ${quoteShellArg(parentDir)}`);

        // Clone the repository
        const cloneResult = await sshService.executeCommand(
          connectionId,
          `git clone ${quoteShellArg(repoUrl.trim())} ${quoteShellArg(targetPath)}`
        );
        if (cloneResult.exitCode !== 0) {
          return {
            success: false,
            error: `Clone failed: ${cloneResult.stderr || cloneResult.stdout}`,
          };
        }

        void import('../telemetry').then(({ capture }) => {
          void capture('ssh_repo_clone');
        });

        return { success: true, path: targetPath };
      } catch (err: any) {
        console.error('[sshIpc] Clone repo error:', err);
        return { success: false, error: err.message };
      }
    }
  );
}
