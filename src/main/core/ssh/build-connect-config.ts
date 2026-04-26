import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { ConnectConfig } from 'ssh2';
import { sshCredentialService } from '@main/core/ssh/ssh-credential-service';
import { resolveIdentityAgent } from '@main/core/ssh/sshConfigParser';
import type { SshConnectionRow } from '@main/db/schema';
import { parseSshConnectionMetadata } from './connection-metadata';
import { createProxyCommandTransport, type ProxyCommandTransport } from './proxy-command';

export interface ManagedConnectConfig extends ConnectConfig {
  cleanupTransport?: () => void;
}

/**
 * Build an ssh2 `ConnectConfig` from a stored `SshConnectionRow`.
 */
export async function buildConnectConfigFromRow(
  row: SshConnectionRow
): Promise<ManagedConnectConfig | undefined> {
  const metadata = parseSshConnectionMetadata(row.metadata);
  let proxyTransport: ProxyCommandTransport | undefined;

  const base: ManagedConnectConfig = {
    host: row.host,
    port: row.port,
    username: row.username,
    readyTimeout: 20_000,
    keepaliveInterval: 60_000,
    keepaliveCountMax: 3,
  };
  if (metadata.proxyCommand) {
    proxyTransport = createProxyCommandTransport(metadata.proxyCommand, {
      host: row.host,
      port: row.port,
      username: row.username,
    });
    base.sock = proxyTransport.sock;
    base.cleanupTransport = proxyTransport.cleanup;
  }

  try {
    switch (row.authType) {
      case 'password': {
        const password = await sshCredentialService.getPassword(row.id);
        if (!password) {
          throw new Error(`No password found for SSH connection '${row.name}' (id: ${row.id})`);
        }
        return { ...base, password };
      }

      case 'key': {
        if (!row.privateKeyPath) {
          throw new Error(`Private key path is required for SSH connection '${row.name}'`);
        }
        let keyPath = row.privateKeyPath;
        if (keyPath.startsWith('~/')) {
          keyPath = keyPath.replace('~', homedir());
        } else if (keyPath === '~') {
          keyPath = homedir();
        }
        const privateKey = await readFile(keyPath, 'utf-8');
        const passphrase = await sshCredentialService.getPassphrase(row.id);
        return { ...base, privateKey, ...(passphrase ? { passphrase } : {}) };
      }

      case 'agent': {
        const identityAgent = await resolveIdentityAgent(row.host);
        const agent = identityAgent || process.env.SSH_AUTH_SOCK;
        if (!agent) {
          throw new Error(
            `SSH agent socket not found for connection '${row.name}'. ` +
              'Ensure the SSH agent is running or use key/password auth.'
          );
        }
        return { ...base, agent };
      }

      default: {
        throw new Error(`Unsupported SSH auth type: ${(row as { authType: string }).authType}`);
      }
    }
  } catch (error) {
    proxyTransport?.cleanup();
    throw error;
  }
}
