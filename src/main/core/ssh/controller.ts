import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { eq } from 'drizzle-orm';
import { Client } from 'ssh2';
import { createRPCController } from '@/shared/ipc/rpc';
import type { ConnectionTestResult, SshConfig } from '@/shared/ssh/types';
import { db } from '@main/db/client';
import { sshConnections as sshConnectionsTable, type SshConnectionInsert } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { sshConnectionManager } from './ssh-connection-manager';
import { sshCredentialService } from './ssh-credential-service';
import { resolveIdentityAgent } from './utils';

export const sshController = createRPCController({
  /** List all saved SSH connections (no secrets). */
  getConnections: async (): Promise<SshConfig[]> => {
    const rows = await db.select().from(sshConnectionsTable);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      host: row.host,
      port: row.port,
      username: row.username,
      authType: row.authType as 'password' | 'key' | 'agent',
      privateKeyPath: row.privateKeyPath ?? undefined,
      useAgent: row.useAgent === 1,
    }));
  },

  /** Create or update an SSH connection, storing secrets in the OS keychain. */
  saveConnection: async (
    config: SshConfig & { password?: string; passphrase?: string }
  ): Promise<SshConfig> => {
    const connectionId = config.id ?? `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
          username: insertData.username,
          authType: insertData.authType,
          privateKeyPath: insertData.privateKeyPath,
          useAgent: insertData.useAgent,
          updatedAt: new Date().toISOString(),
        },
      });

    return { ...dbConfig, id: connectionId };
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
    return new Promise(async (resolve) => {
      const client = new Client();
      const debugLogs: string[] = [];
      const startTime = Date.now();

      client.on('ready', () => {
        const latency = Date.now() - startTime;
        client.end();
        resolve({ success: true, latency, debugLogs });
      });

      client.on('error', (err: Error) => {
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

        if (config.authType === 'password') {
          connectConfig.password = config.password;
        } else if (config.authType === 'key' && config.privateKeyPath) {
          let keyPath = config.privateKeyPath;
          if (keyPath.startsWith('~/')) keyPath = keyPath.replace('~', homedir());
          connectConfig.privateKey = readFileSync(keyPath);
          if (config.passphrase) connectConfig.passphrase = config.passphrase;
        } else if (config.authType === 'agent') {
          const identityAgent = await resolveIdentityAgent(config.host);
          connectConfig.agent = identityAgent || process.env.SSH_AUTH_SOCK;
        }

        client.connect(connectConfig);
      } catch (e) {
        resolve({ success: false, error: (e as Error).message, debugLogs });
      }
    });
  },

  /** Intentionally close a connection and stop auto-reconnect. */
  disconnect: async (connectionId: string): Promise<void> => {
    await sshConnectionManager.disconnect(connectionId);
  },

  /** Returns whether the connection is currently live. */
  getState: async (connectionId: string): Promise<'connected' | 'disconnected'> => {
    return sshConnectionManager.isConnected(connectionId) ? 'connected' : 'disconnected';
  },
});
