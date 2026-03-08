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
 * Parses ~/.ssh/config and returns an array of host entries.
 * Skips wildcard host patterns (containing * or ?).
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
      // Skip wildcard patterns
      if (!hostPattern.includes('*') && !hostPattern.includes('?')) {
        currentHost = { host: hostPattern };
      } else {
        currentHost = null;
      }
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
    const match = hosts.find(
      (h) =>
        h.host.toLowerCase() === hostname.toLowerCase() ||
        h.hostname?.toLowerCase() === hostname.toLowerCase()
    );
    return match?.identityAgent;
  } catch {
    return undefined;
  }
}
