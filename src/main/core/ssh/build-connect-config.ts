import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { ConnectConfig } from 'ssh2';
import { sshCredentialService } from '@main/core/ssh/ssh-credential-service';
import { resolveSshConfigHost } from '@main/core/ssh/sshConfigParser';
import type { SshConnectionRow } from '@main/db/schema';
import { buildProxyJumpSocket } from './proxy-jump-sock';

/**
 * Build an ssh2 `ConnectConfig` from a stored `SshConnectionRow`.
 */
export async function buildConnectConfigFromRow(
  row: SshConnectionRow
): Promise<ConnectConfig | undefined> {
  const configHost = await resolveSshConfigHost(row.host);
  const targetHost = configHost?.hostname ?? row.host;
  const targetPort = configHost?.port ?? row.port;
  const targetUsername = configHost?.user ?? row.username;
  const identityAgent = configHost?.identityAgent;
  const proxyJump = configHost?.proxyJump;

  const base: ConnectConfig = {
    host: targetHost,
    port: targetPort,
    username: targetUsername,
    readyTimeout: 20_000,
    keepaliveInterval: 60_000,
    keepaliveCountMax: 3,
  };
  const authConfig: Partial<ConnectConfig> = {};

  switch (row.authType) {
    case 'password': {
      const password = await sshCredentialService.getPassword(row.id);
      if (!password) {
        throw new Error(`No password found for SSH connection '${row.name}' (id: ${row.id})`);
      }
      authConfig.password = password;
      break;
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
      authConfig.privateKey = privateKey;
      if (passphrase) {
        authConfig.passphrase = passphrase;
      }
      break;
    }

    case 'agent': {
      const agent = identityAgent || process.env.SSH_AUTH_SOCK;
      if (!agent) {
        throw new Error(
          `SSH agent socket not found for connection '${row.name}'. ` +
            'Ensure the SSH agent is running or use key/password auth.'
        );
      }
      authConfig.agent = agent;
      break;
    }

    default: {
      throw new Error(`Unsupported SSH auth type: ${(row as { authType: string }).authType}`);
    }
  }

  const config: ConnectConfig = { ...base, ...authConfig };
  if (proxyJump) {
    config.sock = buildProxyJumpSocket(targetHost, targetPort, proxyJump);
  }
  return config;
}
