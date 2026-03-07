import type { ConnectConfig } from 'ssh2';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { SshConnectionRow } from '../../db/schema';
import { SshCredentialService } from '../../../_deprecated/services/ssh/SshCredentialService';
import { resolveIdentityAgent } from '../../../_deprecated/utils/sshConfigParser';

const credentialService = new SshCredentialService();

/**
 * Build an ssh2 `ConnectConfig` from a stored `SshConnectionRow`.
 * Mirrors the logic in `SshService.buildConnectConfig` so that
 * `SshConnectionManager` can establish connections without going
 * through `SshService`.
 */
export async function buildConnectConfigFromRow(row: SshConnectionRow): Promise<ConnectConfig> {
  const base: ConnectConfig = {
    host: row.host,
    port: row.port,
    username: row.username,
    readyTimeout: 20_000,
    keepaliveInterval: 60_000,
    keepaliveCountMax: 3,
  };

  switch (row.authType) {
    case 'password': {
      const password = await credentialService.getPassword(row.id);
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
      const passphrase = await credentialService.getPassphrase(row.id);
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
}
