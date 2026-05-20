import { readFile } from 'node:fs/promises';
import ssh2 from 'ssh2';
import { sshCredentialService } from '@main/core/ssh/ssh-credential-service';
import { resolveSshConfig } from './resolve-ssh-config';
import {
  createSshConnectConfigResolver,
  type SshConnectInput,
  type SshConnectResult,
} from './resolve-ssh-connect-config';
import { findSshConfigHostByHostName, parseSshConfigFile } from './sshConfigParser';
import { spawnProxyCommand, spawnProxyJump } from './transports';

const { createAgent } = ssh2;

async function findSshConfigByHostName(hostname: string) {
  const hosts = await parseSshConfigFile();
  const match = findSshConfigHostByHostName(hosts, hostname);
  return match ? await resolveSshConfig(match.host).catch(() => undefined) : undefined;
}

export const resolveProductionSshConnectConfig = createSshConnectConfigResolver({
  readFile,
  getPassword: (connectionId) => sshCredentialService.getPassword(connectionId),
  getPassphrase: (connectionId) => sshCredentialService.getPassphrase(connectionId),
  resolveSshConfig,
  findSshConfigByHostName,
  spawnProxyCommand,
  spawnProxyJump,
  createAgent,
  env: process.env,
});

export type { SshConnectInput, SshConnectResult };
