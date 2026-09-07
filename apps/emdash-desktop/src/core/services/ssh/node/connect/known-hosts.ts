import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type HostKeyDecision = 'match' | 'mismatch' | 'unknown';

export function knownHostsPath(home = homedir()): string {
  return join(home, '.ssh', 'known_hosts');
}

export function hostKeyDecision(
  host: string,
  hostKey: Buffer,
  knownHostsContents: string
): HostKeyDecision {
  const hostNames = hostAliases(host);
  let sawHost = false;
  for (const line of knownHostsContents.split(/\r?\n/)) {
    const parsed = parseKnownHostsLine(line);
    if (!parsed) continue;
    if (!hostMatchesEntry(hostNames, parsed.hosts)) continue;
    sawHost = true;
    if (keyMatches(hostKey, parsed.keyType, parsed.keyData)) return 'match';
  }
  if (sawHost) return 'mismatch';
  return 'unknown';
}

export function createKnownHostsVerifier(
  host: string,
  readKnownHosts: () => string | null = () => {
    try {
      return readFileSync(knownHostsPath(), 'utf8');
    } catch {
      return null;
    }
  }
): (key: Buffer, done: (ok: boolean) => void) => void {
  return (key, done) => {
    const contents = readKnownHosts();
    if (!contents) {
      done(true);
      return;
    }
    done(hostKeyDecision(host, key, contents) !== 'mismatch');
  };
}

function hostAliases(host: string): string[] {
  const trimmed = host.trim();
  const aliases = new Set<string>([trimmed, trimmed.toLowerCase()]);
  if (trimmed.includes(':') && !trimmed.startsWith('[')) {
    aliases.add(`[${trimmed}]`);
  }
  return [...aliases];
}

function parseKnownHostsLine(
  line: string
): { hosts: string[]; keyType: string; keyData: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const tokens = trimmed.startsWith('@') ? trimmed.split(/\s+/).slice(1) : trimmed.split(/\s+/);
  if (tokens.length < 3) return null;
  const [hosts, keyType, keyData] = tokens;
  if (!hosts || !keyType || !keyData) return null;
  return { hosts: hosts.split(','), keyType, keyData };
}

function hostMatchesEntry(hostNames: string[], entryHosts: string[]): boolean {
  return entryHosts.some((entry) => {
    if (entry.startsWith('|1|')) return hashedHostMatches(hostNames, entry);
    const normalized = entry.replace(/^\[|\]$/g, '');
    return hostNames.some(
      (candidate) => candidate === entry || candidate.toLowerCase() === entry.toLowerCase() || candidate === normalized
    );
  });
}

function hashedHostMatches(hostNames: string[], entry: string): boolean {
  const parts = entry.split('|');
  if (parts.length !== 4 || parts[1] !== '1' || !parts[2] || !parts[3]) return false;
  const salt = Buffer.from(parts[2], 'base64');
  const digest = Buffer.from(parts[3], 'base64');
  return hostNames.some((host) =>
    createHmac('sha1', salt).update(host).digest().equals(digest)
  );
}

function keyMatches(hostKey: Buffer, keyType: string, keyData: string): boolean {
  try {
    const encoded = hostKey.toString('base64');
    if (encoded === keyData) return true;
    return Buffer.from(keyData, 'base64').equals(hostKey);
  } catch {
    return keyType.length > 0 && false;
  }
}
