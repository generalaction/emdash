import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { Logger } from '@emdash/shared/logger';
import ssh2 from 'ssh2';
import { resolveSshConfig } from '../config/resolve-ssh-config';
import { findSshConfigHostByHostName, parseSshConfigFile } from '../config/sshConfigParser';
import type { SshCredentialService } from '../credentials/ssh-credential-service';
import { spawnProxyCommand, spawnProxyJump } from '../transport/transports';
import { fileKnownHostsStore } from './known-hosts';
import {
  createSshConnectConfigResolver,
  type SshConnectInput,
  type SshConnectResult,
} from './resolve-ssh-connect-config';

const { createAgent } = ssh2;

type ConnectCredentials = Pick<SshCredentialService, 'getPassword' | 'getPassphrase'>;
type ProductionConnectOptions = { log?: Logger };

async function findSshConfigByHostName(hostname: string) {
  const hosts = await parseSshConfigFile();
  const match = findSshConfigHostByHostName(hosts, hostname);
  return match ? await resolveSshConfig(match.host).catch(() => undefined) : undefined;
}

export function createProductionSshConnectConfigResolver(
  credentials: ConnectCredentials,
  options: ProductionConnectOptions = {}
) {
  return createSshConnectConfigResolver({
    readFile,
    getPassword: (connectionId, identity) => credentials.getPassword(connectionId, identity),
    getPassphrase: (connectionId, identity) => credentials.getPassphrase(connectionId, identity),
    resolveSshConfig,
    findSshConfigByHostName,
    spawnProxyCommand,
    spawnProxyJump,
    createAgent,
    env: process.env,
    knownHosts: fileKnownHostsStore,
    homeDir: homedir,
    ...(options.log ? { log: options.log } : {}),
  });
}

export async function resolveProductionSshConnectConfig(
  input: SshConnectInput,
  credentials: ConnectCredentials,
  options: ProductionConnectOptions = {}
): Promise<SshConnectResult> {
  return await createProductionSshConnectConfigResolver(credentials, options)(input);
}

export type { SshConnectInput, SshConnectResult };
