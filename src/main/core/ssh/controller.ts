import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createRPCController } from '@/shared/ipc/rpc';
import { db } from '@main/db/client';
import {
  projects,
  sshConnections as sshConnectionsTable,
  type SshConnectionInsert,
} from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import type {
  ConnectionState,
  ConnectionTestResult,
  FileEntry,
  SshConfig,
  SshConfigHost,
  SshConnectionUsage,
  SshHealthState,
} from '@shared/ssh';
import {
  mergeSshConnectionMetadata,
  parseSshConnectionMetadata,
  serializeSshConnectionMetadata,
  type SshConnectionMetadata,
  sshConfigFromRow,
} from './config/connection-metadata';
import { resolveSshConfig } from './config/resolve-ssh-config';
import { parseSshConfigFile } from './config/sshConfigParser';
import { testProductionSshConnection } from './connect/production-test-connection';
import { sshCredentialService } from './credentials/ssh-credential-service';
import { sshConnectionManager } from './lifecycle/production-ssh-connection-manager';

export const sshController = createRPCController({
  /** List all saved SSH connections (no secrets). */
  getConnections: async (): Promise<SshConfig[]> => {
    const rows = await db.select().from(sshConnectionsTable);
    return rows.map(sshConfigFromRow);
  },

  getSshConfigHosts: async (): Promise<SshConfigHost[]> => {
    return await parseSshConfigFile();
  },

  getSshConfigHost: async (alias: string): Promise<SshConfigHost> => {
    const resolved = await resolveSshConfig(alias);
    return {
      host: alias,
      hostname: resolved.hostname,
      user: resolved.user,
      port: resolved.port,
      identityFile: resolved.identityFile[0],
      identityAgent: resolved.identityAgent,
      proxyJump: resolved.proxyJump,
      proxyCommand: resolved.proxyCommand,
      forwardAgent: resolved.forwardAgent,
      forwardAgentValue: resolved.forwardAgentValue,
    };
  },

  /** List projects currently using each saved SSH connection. */
  getConnectionUsage: async (): Promise<SshConnectionUsage> => {
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        sshConnectionId: projects.sshConnectionId,
      })
      .from(projects);

    const usage: SshConnectionUsage = {};
    for (const row of rows) {
      if (!row.sshConnectionId) continue;
      usage[row.sshConnectionId] ??= [];
      usage[row.sshConnectionId].push({ id: row.id, name: row.name });
    }
    return usage;
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

    const existingMetadata =
      config.id === undefined
        ? {}
        : parseSshConnectionMetadata(
            (
              await db
                .select({ metadata: sshConnectionsTable.metadata })
                .from(sshConnectionsTable)
                .where(eq(sshConnectionsTable.id, connectionId))
                .limit(1)
            )[0]?.metadata ?? null
          );

    const metadataUpdate: SshConnectionMetadata = {};
    if (Object.prototype.hasOwnProperty.call(config, 'worktreesDir')) {
      metadataUpdate.worktreesDir = config.worktreesDir;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'sshConfigAlias')) {
      metadataUpdate.sshConfigAlias = config.sshConfigAlias;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'forwardAgent')) {
      metadataUpdate.forwardAgent = config.forwardAgent;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'proxyJump')) {
      metadataUpdate.proxyJump = config.proxyJump;
    }
    const metadata = mergeSshConnectionMetadata(existingMetadata, metadataUpdate);

    const insertData: SshConnectionInsert = {
      id: connectionId,
      name: dbConfig.name,
      host: dbConfig.host,
      port: dbConfig.port,
      metadata: serializeSshConnectionMetadata(metadata),
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
      worktreesDir: metadata.worktreesDir,
      sshConfigAlias: metadata.sshConfigAlias,
      forwardAgent: metadata.forwardAgent,
      proxyJump: metadata.proxyJump,
    };
  },

  /** Delete a saved SSH connection and its stored credentials. */
  deleteConnection: async (id: string): Promise<void> => {
    const referencingProjects = await db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.sshConnectionId, id));

    if (referencingProjects.length > 0) {
      const projectNames = referencingProjects.map((project) => project.name).join(', ');
      throw new Error(`SSH connection is used by ${projectNames}`);
    }

    if (sshConnectionManager.getConnectionState(id) !== 'disconnected') {
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
    const result = await testProductionSshConnection(config);
    telemetryService.capture('ssh_connection_attempted', { success: result.success });
    return result;
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

  getHealthStates: async (): Promise<Record<string, SshHealthState>> => {
    return sshConnectionManager.getAllHealthStates();
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
      proxy!.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`SFTP error: ${err.message}`));
          return;
        }
        sftp.readdir(remotePath, (readdirErr, list) => {
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
