import type { HostDependencySelection } from '@emdash/shared/deps';
// DB metadata column helpers for SSH connections.
import type { SshConnectionRow } from '@main/db/schema';
import type { SshConfig } from '@shared/core/ssh/ssh';
import type { SshConnectionMetadata } from '@shared/core/ssh/ssh-connection-metadata';

export type { SshConnectionMetadata };

type SshConnectionMetadataUpdate = {
  sshConfigAlias?: string;
  forwardAgent?: boolean;
  proxyJump?: string;
};

const SSH_ALIAS_PATTERN = /^[\w.@%+:/[\]-]+$/;

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalSshConfigAlias(value: unknown): string | undefined {
  const alias = optionalString(value);
  if (!alias) return undefined;
  if (alias.startsWith('-') || !SSH_ALIAS_PATTERN.test(alias)) {
    throw new Error(`Invalid SSH config alias: ${alias}`);
  }
  return alias;
}

export function mergeSshConnectionMetadata(
  existing: SshConnectionMetadata,
  update: SshConnectionMetadataUpdate
): SshConnectionMetadata {
  const has = (key: keyof SshConnectionMetadataUpdate) =>
    Object.prototype.hasOwnProperty.call(update, key);

  return {
    ...existing,
    sshConfigAlias: has('sshConfigAlias')
      ? optionalSshConfigAlias(update.sshConfigAlias)
      : existing.sshConfigAlias,
    forwardAgent: has('forwardAgent') ? update.forwardAgent : existing.forwardAgent,
    proxyJump: has('proxyJump') ? optionalString(update.proxyJump) : existing.proxyJump,
  };
}

/** Merge a single dependency selection into the existing SSH connection metadata. */
export function mergeDependencySelection(
  existing: SshConnectionMetadata,
  depId: string,
  selection: HostDependencySelection
): SshConnectionMetadata {
  return {
    ...existing,
    dependencySelections: {
      ...existing.dependencySelections,
      [depId]: selection,
    },
  };
}

export function sshConfigFromRow(row: SshConnectionRow): SshConfig {
  const metadata = row.metadata ?? {};
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.authType as 'password' | 'key' | 'agent',
    privateKeyPath: row.privateKeyPath ?? undefined,
    useAgent: row.useAgent === 1,
    sshConfigAlias: metadata.sshConfigAlias,
    forwardAgent: metadata.forwardAgent,
    proxyJump: metadata.proxyJump,
  };
}
