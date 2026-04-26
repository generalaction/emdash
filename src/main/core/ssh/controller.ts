import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { eq } from 'drizzle-orm';
import { Client } from 'ssh2';
import { createRPCController } from '@/shared/ipc/rpc';
import type { ConnectionState, ConnectionTestResult, FileEntry, SshConfig } from '@shared/ssh';
import { db } from '@main/db/client';
import { sshConnections as sshConnectionsTable, type SshConnectionInsert } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { capture } from '@main/lib/telemetry';
import { parseSshConnectionMetadata, serializeSshConnectionMetadata } from './connection-metadata';
import { createProxyCommandTransport } from './proxy-command';
import { sshConnectionManager } from './ssh-connection-manager';
import { sshCredentialService } from './ssh-credential-service';
import { resolveIdentityAgent } from './utils';

export const sshController = createRPCController({
  /** List all saved SSH connections (no secrets). */
  getConnections: async (): Promise<SshConfig[]> => {
    const rows = await db.select().from(sshConnectionsTable);
    return rows.map((row) => {
      const metadata = parseSshConnectionMetadata(row.metadata);
      return {
        id: row.id,
        name: row.name,
        host: row.host,
        port: row.port,
        username: row.username,
        proxyCommand: metadata.proxyCommand,
        worktreesDir: metadata.worktreesDir,
        authType: row.authType as 'password' | 'key' | 'agent',
        privateKeyPath: row.privateKeyPath ?? undefined,
        useAgent: row.useAgent === 1,
      };
    });
  },

  /** Create or update an SSH connection, storing secrets in local secure storage. */
  saveConnection: async (
    config: Partial<Pick<SshConfig, 'id'>> &
      Omit<SshConfig, 'id'> & { password?: string; passphrase?: string }
  ): Promise<SshConfig> => {
    const connectionId = config.id ?? randomUUID();

    // Only update stored credentials when a non-empty value is provided.
    // On edits, leaving a field blank means "keep the existing credential".
    if (config.password) {
      await sshCredentialService.storePassword(connectionId, config.password);
    }
    if (config.passphrase) {
      await sshCredentialService.storePassphrase(connectionId, config.passphrase);
    }

    const { password: _p, passphrase: _pp, ...dbConfig } = config;

    const insertData: SshConnectionInsert = {
      id: connectionId,
      name: dbConfig.name,
      host: dbConfig.host,
      port: dbConfig.port,
      metadata: serializeSshConnectionMetadata({
        worktreesDir: config.worktreesDir,
        proxyCommand: config.proxyCommand,
      }),
      username: dbConfig.username,
      authType: dbConfig.authType,
      privateKeyPath: dbConfig.privateKeyPath ?? null,
      useAgent: dbConfig.useAgent ? 1 : 0,
    };

    await db
      .insert(sshConnectionsTable)
      .values(insertData)
      .onConflictDoUpdate({
        target: sshConnectionsTable.id,
        set: {
          name: insertData.name,
          host: insertData.host,
          port: insertData.port,
          metadata: insertData.metadata,
          username: insertData.username,
          authType: insertData.authType,
          privateKeyPath: insertData.privateKeyPath,
          useAgent: insertData.useAgent,
          updatedAt: new Date().toISOString(),
        },
      });

    return {
      ...dbConfig,
      id: connectionId,
      proxyCommand: config.proxyCommand,
      worktreesDir: config.worktreesDir,
    };
  },

  /** Delete a saved SSH connection and its stored credentials. */
  deleteConnection: async (id: string): Promise<void> => {
    if (sshConnectionManager.isConnected(id)) {
      await sshConnectionManager.disconnect(id).catch((e) => {
        log.warn('sshController.deleteConnection: error disconnecting', {
          connectionId: id,
          error: String(e),
        });
      });
    }
    await sshCredentialService.deleteAllCredentials(id);
    await db.delete(sshConnectionsTable).where(eq(sshConnectionsTable.id, id));
  },

  /** Test a connection without persisting anything. */
  testConnection: async (
    config: SshConfig & { password?: string; passphrase?: string }
  ): Promise<ConnectionTestResult> => {
    let identityAgent: string | undefined;
    if (config.authType === 'agent') {
      identityAgent = await resolveIdentityAgent(config.host);
    }

    return new Promise((resolve) => {
      const client = new Client();
      const debugLogs: string[] = [];
      const startTime = Date.now();
      let cleanupTransport: (() => void) | undefined;

      client.on('close', () => {
        cleanupTransport?.();
      });

      client.on('ready', () => {
        const latency = Date.now() - startTime;
        client.end();
        capture('ssh_connection_attempted', { success: true });
        resolve({ success: true, latency, debugLogs });
      });

      client.on('error', (err: Error) => {
        capture('ssh_connection_attempted', { success: false });
        resolve({ success: false, error: err.message, debugLogs });
      });

      try {
        const connectConfig: Parameters<Client['connect']>[0] = {
          host: config.host,
          port: config.port,
          username: config.username,
          readyTimeout: 10_000,
          debug: (info: string) => debugLogs.push(info),
        };
        if (config.proxyCommand) {
          const proxyTransport = createProxyCommandTransport(config.proxyCommand, {
            host: config.host,
            port: config.port,
            username: config.username,
            onDebug: (line) => debugLogs.push(line),
          });
          connectConfig.sock = proxyTransport.sock;
          cleanupTransport = proxyTransport.cleanup;
        }

        if (config.authType === 'password') {
          connectConfig.password = config.password;
        } else if (config.authType === 'key' && config.privateKeyPath) {
          let keyPath = config.privateKeyPath;
          if (keyPath.startsWith('~/')) keyPath = keyPath.replace('~', homedir());
          connectConfig.privateKey = readFileSync(keyPath);
          if (config.passphrase) connectConfig.passphrase = config.passphrase;
        } else if (config.authType === 'agent') {
          connectConfig.agent = identityAgent || process.env.SSH_AUTH_SOCK;
        }

        client.connect(connectConfig);
      } catch (e) {
        cleanupTransport?.();
        capture('ssh_connection_attempted', { success: false });
        resolve({ success: false, error: (e as Error).message, debugLogs });
      }
    });
  },

  /** Intentionally close a connection and stop auto-reconnect. */
  disconnect: async (connectionId: string): Promise<void> => {
    await sshConnectionManager.disconnect(connectionId);
  },

  /** Ensure a connection is established (no-op if already connected). */
  connect: async (connectionId: string): Promise<ConnectionState> => {
    await sshConnectionManager.connect(connectionId);
    return sshConnectionManager.getConnectionState(connectionId);
  },

  /** Returns whether the connection is currently live. */
  getState: async (connectionId: string): Promise<'connected' | 'disconnected'> => {
    return sshConnectionManager.isConnected(connectionId) ? 'connected' : 'disconnected';
  },
  /** Returns the current ConnectionState for every connection tracked by the manager. */
  getConnectionState: async (): Promise<Record<string, ConnectionState>> => {
    return sshConnectionManager.getAllConnectionStates();
  },

  /** Rename a saved SSH connection without changing any other fields. */
  renameConnection: async (id: string, name: string): Promise<void> => {
    const [row] = await db.select().from(sshConnectionsTable).where(eq(sshConnectionsTable.id, id));
    if (!row) throw new Error(`SSH connection ${id} not found`);
    await db
      .update(sshConnectionsTable)
      .set({ name, updatedAt: new Date().toISOString() })
      .where(eq(sshConnectionsTable.id, id));
  },

  /** List files/directories at a remote path via SFTP. */
  listFiles: async ({
    connectionId,
    path: remotePath,
  }: {
    connectionId: string;
    path: string;
  }): Promise<FileEntry[]> => {
    let proxy = sshConnectionManager.getProxy(connectionId);

    if (!proxy || !proxy.isConnected) {
      proxy = await sshConnectionManager.connect(connectionId);
    }

    return new Promise((resolve, reject) => {
      proxy!.client.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`SFTP error: ${err.message}`));
          return;
        }
        sftp.readdir(remotePath, (readdirErr, list) => {
          sftp.end();
          if (readdirErr) {
            reject(new Error(`readdir error: ${readdirErr.message}`));
            return;
          }
          const entries: FileEntry[] = list
            .map((item) => {
              const mode = item.attrs.mode ?? 0;
              const isDir = (mode & 0o170000) === 0o040000;
              const isLink = (mode & 0o170000) === 0o120000;
              const entryType: FileEntry['type'] = isLink
                ? 'symlink'
                : isDir
                  ? 'directory'
                  : 'file';
              const fullPath = `${remotePath.replace(/\/$/, '')}/${item.filename}`;
              return {
                path: fullPath,
                name: item.filename,
                type: entryType,
                size: item.attrs.size ?? 0,
                modifiedAt: new Date((item.attrs.mtime ?? 0) * 1000),
              };
            })
            .sort((a, b) => {
              if (a.type === 'directory' && b.type !== 'directory') return -1;
              if (a.type !== 'directory' && b.type === 'directory') return 1;
              return a.name.localeCompare(b.name);
            });
          resolve(entries);
        });
      });
    });
  },
});
