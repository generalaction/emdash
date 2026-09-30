import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SshConfig } from '@core/primitives/ssh/api';
import type { ResolvedSshConfig } from '../config/resolve-ssh-config';

export function effectiveSshConfig<T extends Omit<SshConfig, 'id'>>(
  config: T,
  resolved?: ResolvedSshConfig
): T {
  return {
    ...config,
    host: resolved?.hostname || config.host,
    port: resolved?.port ?? config.port,
    username: resolved?.user || config.username,
  };
}

export function assertPasswordDestination(
  config: Omit<SshConfig, 'id'>,
  effective: Omit<SshConfig, 'id'>
) {
  if (
    config.authType === 'password' &&
    (config.host !== effective.host ||
      config.port !== effective.port ||
      config.username !== effective.username)
  ) {
    throw new Error(
      'SSH config changed the destination. Resolve the host again before continuing.'
    );
  }
}

export function sshCredentialIdentity(
  config: Omit<SshConfig, 'id'>,
  keyFingerprint?: string
): string {
  if (config.authType === 'key' && !keyFingerprint)
    throw new Error('Private key identity is required');
  return createHash('sha256')
    .update(
      JSON.stringify([
        config.host,
        config.port,
        config.username,
        config.authType,
        config.sshConfigAlias || '',
        config.sshConfigAlias ? '' : config.proxyJump || '',
        config.authType === 'key' ? config.privateKeyPath?.trim() || '' : '',
        config.authType === 'key' ? keyFingerprint : '',
      ])
    )
    .digest('hex');
}

export function expandSshKeyPath(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/') || (process.platform === 'win32' && path.startsWith('~\\'))) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export async function readSshPrivateKey(
  config: Omit<SshConfig, 'id'>,
  resolved: ResolvedSshConfig | undefined,
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>
) {
  const selected = config.privateKeyPath?.trim() || resolved?.identityFile[0];
  if (!selected)
    throw new Error(`Private key path is required for SSH connection '${config.name}'`);
  const path = expandSshKeyPath(selected);
  const privateKey = await readFile(path, 'utf-8');
  // Include contents to detect replacement at the same path, not just IdentityFile edits.
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([path, privateKey]))
    .digest('hex');
  return { privateKey, fingerprint };
}
