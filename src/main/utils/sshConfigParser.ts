import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import type { SshConfigHost } from '../../shared/ssh/types';

/**
 * Strips surrounding quotes (single or double) from a value string.
 */
function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Expands a leading `~` or `~/` to the user's home directory.
 */
function expandTilde(filePath: string): string {
  if (filePath === '~') {
    return homedir();
  }
  if (filePath.startsWith('~/')) {
    return join(homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * Parses ~/.ssh/config and returns an array of host entries,
 * including wildcard patterns (Host *, Host ?).
 */
export async function parseSshConfigFile(): Promise<SshConfigHost[]> {
  const configPath = join(homedir(), '.ssh', 'config');
  const content = await readFile(configPath, 'utf-8').catch(() => '');

  const hosts: SshConfigHost[] = [];
  const lines = content.split('\n');
  let currentHost: SshConfigHost | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Match Host directive
    const hostMatch = trimmed.match(/^Host\s+(.+)$/i);
    if (hostMatch) {
      // Save previous host if exists
      if (currentHost && currentHost.host) {
        hosts.push(currentHost);
      }
      // Start new host entry
      const hostPattern = hostMatch[1].trim();
      currentHost = { host: hostPattern };
      continue;
    }

    // Match HostName
    const hostnameMatch = trimmed.match(/^HostName\s+(.+)$/i);
    if (hostnameMatch && currentHost) {
      currentHost.hostname = hostnameMatch[1].trim();
      continue;
    }

    // Match User
    const userMatch = trimmed.match(/^User\s+(.+)$/i);
    if (userMatch && currentHost) {
      currentHost.user = userMatch[1].trim();
      continue;
    }

    // Match Port
    const portMatch = trimmed.match(/^Port\s+(\d+)$/i);
    if (portMatch && currentHost) {
      currentHost.port = parseInt(portMatch[1], 10);
      continue;
    }

    // Match IdentityFile
    const identityMatch = trimmed.match(/^IdentityFile\s+(.+)$/i);
    if (identityMatch && currentHost) {
      const identityFile = expandTilde(stripQuotes(identityMatch[1].trim()));
      currentHost.identityFile = identityFile;
      continue;
    }

    // Match IdentityAgent
    const identityAgentMatch = trimmed.match(/^IdentityAgent\s+(.+)$/i);
    if (identityAgentMatch && currentHost) {
      const identityAgent = expandTilde(stripQuotes(identityAgentMatch[1].trim()));
      currentHost.identityAgent = identityAgent;
      continue;
    }

    // Match ProxyCommand (supports both "ProxyCommand value" and "ProxyCommand=value")
    const proxyCommandMatch = trimmed.match(/^ProxyCommand[\s=]+(.+)$/i);
    if (proxyCommandMatch && currentHost) {
      currentHost.proxyCommand = proxyCommandMatch[1].trim();
      continue;
    }
  }

  // Don't forget the last host
  if (currentHost && currentHost.host) {
    hosts.push(currentHost);
  }

  return hosts;
}

/**
 * Resolves the IdentityAgent socket path for a given hostname.
 *
 * Parses ~/.ssh/config and finds a matching host entry by checking
 * both the Host alias and the HostName value. Returns the expanded
 * IdentityAgent path if found, or undefined.
 */
export async function resolveIdentityAgent(hostname: string): Promise<string | undefined> {
  try {
    const hosts = await parseSshConfigFile();

    // Look for a specific (non-wildcard) host match first
    const specificMatch = hosts.find(
      (h) =>
        !h.host.includes('*') &&
        !h.host.includes('?') &&
        (h.host.toLowerCase() === hostname.toLowerCase() ||
          h.hostname?.toLowerCase() === hostname.toLowerCase())
    );
    if (specificMatch?.identityAgent) {
      return normalizeIdentityAgent(specificMatch.identityAgent);
    }

    // Fall back to Host * (wildcard default), matching OpenSSH behavior
    const wildcardMatch = hosts.find((h) => h.host === '*');
    return normalizeIdentityAgent(wildcardMatch?.identityAgent);
  } catch {
    return undefined;
  }
}

/**
 * Normalizes an IdentityAgent value.
 * OpenSSH treats "SSH_AUTH_SOCK" as "use the env var" and "none" as
 * "disable agent auth". Both should return undefined so the caller
 * falls back to process.env.SSH_AUTH_SOCK or skips agent auth.
 */
function normalizeIdentityAgent(value: string | undefined): string | undefined {
  if (!value || value === 'SSH_AUTH_SOCK' || value.toLowerCase() === 'none') {
    return undefined;
  }
  return value;
}

/**
 * Tests whether a hostname matches an SSH Host pattern.
 * Supports `*` and `?` wildcards as per OpenSSH.
 */
function hostPatternMatches(pattern: string, hostname: string): boolean {
  const regexStr = pattern
    .split('')
    .map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${regexStr}$`, 'i').test(hostname);
}

/**
 * Resolves the ProxyCommand for a given hostname from ~/.ssh/config.
 *
 * Matches host entries in order (first match wins), supporting glob
 * wildcards (`*`, `?`). Replaces `%h` with the hostname and `%p`
 * with the port, matching OpenSSH token substitution behavior.
 *
 * NOTE: This uses a two-pass approach (specific hosts first, then
 * wildcards) which diverges from OpenSSH's strict file-order
 * first-match-wins semantics. In rare edge cases where a wildcard
 * block appears before a specific host block that sets
 * `ProxyCommand none`, the results may differ from `ssh`. A fully
 * spec-correct implementation would require single-pass in-order
 * matching with cumulative keyword application.
 */
export async function resolveProxyCommand(
  hostname: string,
  port: number = 22
): Promise<string | undefined> {
  try {
    const hosts = await parseSshConfigFile();

    // OpenSSH applies settings cumulatively: first matching Host block
    // that defines ProxyCommand wins. Check specific match first, then
    // walk all entries in order for wildcard/glob matches.
    const specificMatch = hosts.find(
      (h) =>
        !h.host.includes('*') &&
        !h.host.includes('?') &&
        (h.host.toLowerCase() === hostname.toLowerCase() ||
          h.hostname?.toLowerCase() === hostname.toLowerCase())
    );
    if (specificMatch?.proxyCommand) {
      const cmd = specificMatch.proxyCommand;
      if (cmd.toLowerCase() === 'none') return undefined;
      return cmd.replace(/%h/g, hostname).replace(/%p/g, String(port));
    }

    // Fall back to wildcard/glob patterns in order
    for (const h of hosts) {
      if (h.proxyCommand && hostPatternMatches(h.host, hostname)) {
        if (h.proxyCommand.toLowerCase() === 'none') return undefined;
        return h.proxyCommand.replace(/%h/g, hostname).replace(/%p/g, String(port));
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}
