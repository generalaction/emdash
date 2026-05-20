import type { SshConnectionRow } from '@main/db/schema';
import type { SshConfig } from '@shared/ssh';

export interface SshConnectionMetadata {
  worktreesDir?: string;
  sshConfigAlias?: string;
  forwardAgent?: boolean;
  proxyJump?: string;
}

type SshConnectionMetadataUpdate = {
  worktreesDir?: string | undefined;
  sshConfigAlias?: string | undefined;
  forwardAgent?: boolean | undefined;
  proxyJump?: string | undefined;
};

const SSH_ALIAS_PATTERN = /^[A-Za-z0-9._@%+:/[\]-]+$/;

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

export function parseSshConnectionMetadata(metadata: string | null): SshConnectionMetadata {
  if (!metadata) return {};

  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    const result: SshConnectionMetadata = {};
    const worktreesDir = optionalString(parsed.worktreesDir);
    const sshConfigAlias = optionalSshConfigAlias(parsed.sshConfigAlias);
    const proxyJump = optionalString(parsed.proxyJump);
    if (worktreesDir) result.worktreesDir = worktreesDir;
    if (sshConfigAlias) result.sshConfigAlias = sshConfigAlias;
    if (typeof parsed.forwardAgent === 'boolean') result.forwardAgent = parsed.forwardAgent;
    if (proxyJump) result.proxyJump = proxyJump;
    return result;
  } catch {
    return {};
  }
}

export function serializeSshConnectionMetadata(metadata: SshConnectionMetadata): string {
  return JSON.stringify({
    worktreesDir: optionalString(metadata.worktreesDir),
    sshConfigAlias: optionalSshConfigAlias(metadata.sshConfigAlias),
    forwardAgent: typeof metadata.forwardAgent === 'boolean' ? metadata.forwardAgent : undefined,
    proxyJump: optionalString(metadata.proxyJump),
  });
}

export function mergeSshConnectionMetadata(
  existing: SshConnectionMetadata,
  update: SshConnectionMetadataUpdate
): SshConnectionMetadata {
  const has = (key: keyof SshConnectionMetadataUpdate) =>
    Object.prototype.hasOwnProperty.call(update, key);

  return {
    worktreesDir: has('worktreesDir') ? optionalString(update.worktreesDir) : existing.worktreesDir,
    sshConfigAlias: has('sshConfigAlias')
      ? optionalSshConfigAlias(update.sshConfigAlias)
      : existing.sshConfigAlias,
    forwardAgent: has('forwardAgent') ? update.forwardAgent : existing.forwardAgent,
    proxyJump: has('proxyJump') ? optionalString(update.proxyJump) : existing.proxyJump,
  };
}

export function sshConfigFromRow(row: SshConnectionRow): SshConfig {
  const metadata = parseSshConnectionMetadata(row.metadata);
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.authType as 'password' | 'key' | 'agent',
    privateKeyPath: row.privateKeyPath ?? undefined,
    useAgent: row.useAgent === 1,
    worktreesDir: metadata.worktreesDir,
    sshConfigAlias: metadata.sshConfigAlias,
    forwardAgent: metadata.forwardAgent,
    proxyJump: metadata.proxyJump,
  };
}
