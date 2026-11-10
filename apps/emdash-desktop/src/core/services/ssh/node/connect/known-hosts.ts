// OpenSSH known_hosts verification for ssh2 connections. ssh2 accepts any host key
// unless a `hostVerifier` is installed, so trust-on-first-use lives here: a host seen
// before must present the same key, an unseen host is recorded, and a revoked or
// changed key is refused.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { isIPv6, SocketAddress } from 'node:net';
import { dirname, join } from 'node:path';
import { quoteArg } from '@emdash/core/primitives/exec/api';
import type { Logger } from '@emdash/shared/logger';
import type { ServerHostKeyAlgorithm, SyncHostVerifier } from 'ssh2';
import { SshConnectionFailure } from '@core/primitives/ssh/api/node/connection-control';
import type { ResolvedSshConfig } from '../config/resolve-ssh-config';

export type KnownHostsMarker = 'cert-authority' | 'revoked';

export interface KnownHostsEntry {
  file: string;
  line: number;
  marker?: KnownHostsMarker;
  /** Comma-separated host patterns of the line, split; hashed patterns start with `|1|`. */
  patterns: string[];
  keyType: string;
  key: Buffer;
}

export type HostKeyVerdict =
  | { kind: 'known'; entry: KnownHostsEntry }
  | { kind: 'unknown' }
  | { kind: 'changed'; entry: KnownHostsEntry }
  /** The host is recorded, but only under other key algorithms. */
  | { kind: 'mismatched-type'; entry: KnownHostsEntry }
  | { kind: 'revoked'; entry: KnownHostsEntry };

export interface HostKeyRejection {
  verdict: Extract<HostKeyVerdict, { kind: 'changed' | 'mismatched-type' | 'revoked' }>;
  message: string;
}

/** Filesystem seam so tests verify against in-memory files. */
export interface KnownHostsStore {
  /** File contents, or null when the file does not exist. Other failures throw. */
  read(path: string): Promise<string | null>;
  /** Appends one line, creating the file (and its directory) with private permissions. */
  append(path: string, line: string): Promise<void>;
}

const HASHED_PREFIX = '|1|';
const MAX_KEY_TYPE_LENGTH = 64;
/** How OpenSSH for Windows spells its system directory in the paths `ssh -G` prints. */
const PROGRAM_DATA_PLACEHOLDER = '__PROGRAMDATA__';
// What cmd.exe, PowerShell or Git Bash still rewrite inside double quotes: the characters
// they expand, and the doubled backslash of a network path, which Git Bash halves.
const REWRITTEN_IN_DOUBLE_QUOTES = /[$`%!"]|\\\\/;

/**
 * ssh2's host key algorithms in its default order of preference, each with the key type
 * it signs with. `ssh-dss` and the `sk-` types are left out: ssh2 does not offer them by
 * default, and a line in known_hosts is no reason to start.
 */
const HOST_KEY_ALGORITHMS: ReadonlyArray<readonly [ServerHostKeyAlgorithm, keyType: string]> = [
  ['ssh-ed25519', 'ssh-ed25519'],
  ['ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp256'],
  ['ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp384'],
  ['ecdsa-sha2-nistp521', 'ecdsa-sha2-nistp521'],
  ['rsa-sha2-512', 'ssh-rsa'],
  ['rsa-sha2-256', 'ssh-rsa'],
  ['ssh-rsa', 'ssh-rsa'],
];

export const fileKnownHostsStore: KnownHostsStore = {
  async read(path) {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  },
  async append(path, line) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // A file without a trailing newline (hand-edited, or written by tools that omit
    // it) would otherwise absorb the new record into its last line.
    const existing = await this.read(path);
    const separator = existing && !existing.endsWith('\n') ? '\n' : '';
    await appendFile(path, separator + line, { mode: 0o600 });
  },
};

export interface KnownHostsFiles {
  /** Files OpenSSH would read and write for the user; the first records new hosts. */
  user: string[];
  /** System-wide files, read only. */
  global: string[];
}

/**
 * The known_hosts files for a connection: what `ssh -G` resolved for the alias, else
 * OpenSSH's defaults. `~` expands against the OS home directory, not HOME alone.
 */
export function defaultKnownHostsFiles(
  home: string,
  env: Record<string, string | undefined>,
  resolved?: Pick<ResolvedSshConfig, 'userKnownHostsFile' | 'globalKnownHostsFile'>
): KnownHostsFiles {
  const programData = env.ProgramData ?? 'C:\\ProgramData';
  const expand = (file: string) =>
    file.startsWith(PROGRAM_DATA_PLACEHOLDER)
      ? programData + file.slice(PROGRAM_DATA_PLACEHOLDER.length)
      : expandHomePath(file, home);
  const user = resolved?.userKnownHostsFile ?? ['~/.ssh/known_hosts', '~/.ssh/known_hosts2'];
  const global =
    resolved?.globalKnownHostsFile ??
    (process.platform === 'win32'
      ? [join(programData, 'ssh', 'ssh_known_hosts')]
      : ['/etc/ssh/ssh_known_hosts', '/etc/ssh/ssh_known_hosts2']);
  return { user: user.map(expand), global: global.map(expand) };
}

export function expandHomePath(file: string, home: string): string {
  if (file === '~') return home;
  if (file.startsWith('~/') || file.startsWith('~\\')) return join(home, file.slice(2));
  return file;
}

/**
 * Parses one known_hosts file. Lines are `[@marker] patterns keytype base64 [comment]`;
 * malformed lines are skipped the way OpenSSH skips them, never treated as a match.
 */
export function parseKnownHosts(content: string, file: string): KnownHostsEntry[] {
  const entries: KnownHostsEntry[] = [];
  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (!line || line.startsWith('#')) continue;
    const fields = line.split(/\s+/u);
    let marker: KnownHostsMarker | undefined;
    if (fields[0]!.startsWith('@')) {
      const name = fields.shift()!.slice(1);
      if (name !== 'cert-authority' && name !== 'revoked') continue;
      marker = name;
    }
    const [patterns, keyType, encodedKey] = fields;
    if (!patterns || !keyType || !encodedKey) continue;
    const key = decodeBase64(encodedKey);
    // The blob names its own algorithm; a line whose type disagrees with its key is corrupt.
    if (!key || hostKeyType(key) !== keyType) continue;
    entries.push({
      file,
      line: index + 1,
      ...(marker ? { marker } : {}),
      patterns: patterns.split(',').filter(Boolean),
      keyType,
      key,
    });
  }
  return entries;
}

/** The algorithm name a public-key blob starts with (`ssh-ed25519`, `ecdsa-sha2-nistp256`, ...). */
export function hostKeyType(key: Buffer): string | undefined {
  if (key.length < 4) return undefined;
  const length = key.readUInt32BE(0);
  if (length === 0 || length > MAX_KEY_TYPE_LENGTH || key.length < 4 + length) return undefined;
  const type = key.subarray(4, 4 + length).toString('latin1');
  return /^[\w.@-]+$/u.test(type) ? type : undefined;
}

/** OpenSSH-style `SHA256:<base64 without padding>` fingerprint. */
export function hostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/u, '')}`;
}

/**
 * The one name OpenSSH looks a destination up under, and records it as. A `HostKeyAlias`
 * replaces host and port alike, so every port shares the alias's keys. Otherwise it is
 * the host name, in brackets with the port unless the port is 22. OpenSSH lowercases
 * either before it matches or hashes, so `Dev.Example.com` finds the hashed line written
 * for `dev.example.com`, and it spells an IPv6 address the shortest way. One difference
 * remains: OpenSSH also expands an IPv4 address typed in a short form (`127.1`), which
 * stays as typed here.
 */
export function knownHostsName(host: string, port: number, hostKeyAlias?: string): string {
  if (hostKeyAlias) return lowercaseAscii(hostKeyAlias);
  const name = shortestIPv6(lowercaseAscii(host));
  return port === 22 ? name : `[${name}]:${port}`;
}

/** `2001:0db8:0:0:0:0:0:1` as `2001:db8::1`, keeping any `%zone`; other hosts unchanged. */
function shortestIPv6(host: string): string {
  const [address = host, ...zone] = host.split('%');
  if (!isIPv6(address)) return host;
  return [new SocketAddress({ address, family: 'ipv6' }).address, ...zone].join('%');
}

/** Lowercases A-Z and nothing else, as OpenSSH does: `Ä` stays `Ä` in the name it uses. */
function lowercaseAscii(value: string): string {
  return value.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
}

/**
 * Whether a line's patterns select `name`: a hashed pattern must reproduce its HMAC, a
 * plain one is a glob (`*`, `?`) lowercased the way the name is, and a `!`-negated match
 * excludes the whole line.
 */
export function matchesHostPatterns(patterns: string[], name: string): boolean {
  let matched = false;
  for (const pattern of patterns) {
    if (pattern.startsWith(HASHED_PREFIX)) {
      if (matchesHashedPattern(pattern, name)) matched = true;
      continue;
    }
    const negated = pattern.startsWith('!');
    const glob = globToRegExp(negated ? pattern.slice(1) : pattern);
    if (!glob?.test(name)) continue;
    if (negated) return false;
    matched = true;
  }
  return matched;
}

/**
 * How `key` relates to the entries recorded for `name`. A revoked match wins over
 * everything; otherwise an identical key is known, a different key of the same type is a
 * change, a key of a type the host was never recorded with is a type mismatch, and only
 * a host with no lines at all is a first sighting. The mismatch is refused rather than
 * recorded, as OpenSSH does: with no one to approve it, "offer a different algorithm"
 * would otherwise be a free bypass of every saved key.
 */
export function judgeHostKey(
  entries: readonly KnownHostsEntry[],
  name: string,
  key: Buffer
): HostKeyVerdict {
  const keyType = hostKeyType(key);
  let known: KnownHostsEntry | undefined;
  let changed: KnownHostsEntry | undefined;
  let otherType: KnownHostsEntry | undefined;
  for (const entry of entries) {
    if (!matchesHostPatterns(entry.patterns, name)) continue;
    const same = entry.key.length === key.length && timingSafeEqual(entry.key, key);
    if (entry.marker === 'revoked') {
      if (same) return { kind: 'revoked', entry };
      continue;
    }
    // Certificate authorities vouch for host certificates, which ssh2 never hands us.
    if (entry.marker === 'cert-authority') continue;
    if (same) known ??= entry;
    else if (entry.keyType === keyType) changed ??= entry;
    else otherType ??= entry;
  }
  if (known) return { kind: 'known', entry: known };
  if (changed) return { kind: 'changed', entry: changed };
  if (otherType) return { kind: 'mismatched-type', entry: otherType };
  return { kind: 'unknown' };
}

/**
 * The host key algorithms to ask `name` for first: those whose key type is on file for
 * it. As in OpenSSH, a type counts unless the first key of that type on file is revoked.
 * ssh2 otherwise asks every server for an Ed25519 key first, so a server recorded years
 * ago by its ECDSA or RSA key would present a key that is not on file and be refused.
 */
export function knownHostKeyAlgorithms(
  entries: readonly KnownHostsEntry[],
  name: string
): ServerHostKeyAlgorithm[] {
  const matching = entries.filter((entry) => matchesHostPatterns(entry.patterns, name));
  const revoked = matching.filter((entry) => entry.marker === 'revoked');
  return HOST_KEY_ALGORITHMS.filter(([, keyType]) => {
    const first = matching.find((entry) => !entry.marker && entry.keyType === keyType);
    return first !== undefined && !revoked.some((line) => line.key.equals(first.key));
  }).map(([algorithm]) => algorithm);
}

/** One known_hosts line for `name`, which {@link knownHostsName} builds. */
function formatKnownHostsLine(name: string, key: Buffer): string {
  return `${name} ${hostKeyType(key) ?? 'unknown'} ${key.toString('base64')}\n`;
}

/**
 * Reads every known_hosts file that exists. A missing file is simply empty; any other
 * failure refuses the connection, since an unreadable file would otherwise turn every
 * host into a first sighting and silently disable the check.
 */
export async function loadKnownHosts(
  files: readonly string[],
  store: KnownHostsStore
): Promise<KnownHostsEntry[]> {
  const entries: KnownHostsEntry[] = [];
  for (const file of files) {
    let content: string | null;
    try {
      content = await store.read(file);
    } catch (error) {
      throw new SshConnectionFailure(
        'configuration',
        `Cannot read SSH known hosts file ${file}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
    if (content !== null) entries.push(...parseKnownHosts(content, file));
  }
  return entries;
}

export interface HostKeyVerifierOptions {
  host: string;
  port: number;
  /** OpenSSH `HostKeyAlias`: looked up and recorded in place of the host and port. */
  hostKeyAlias?: string;
  entries: readonly KnownHostsEntry[];
  /** Where a first-seen key is recorded; omit to accept without recording. */
  recordTo?: string;
  store: KnownHostsStore;
  log?: Logger;
  /** Whose shells the recovery command is quoted for; defaults to this machine's. */
  platform?: NodeJS.Platform;
}

export interface HostKeyVerifier {
  verify: SyncHostVerifier;
  /** Set once `verify` refused a key, so the connection error can say why. */
  rejection(): HostKeyRejection | undefined;
  /** Host key algorithms to ask for first, so the server presents a key type on file. */
  algorithms: ServerHostKeyAlgorithm[];
}

/**
 * Builds the synchronous ssh2 `hostVerifier`. Entries are loaded up front because ssh2
 * calls the verifier in the middle of key exchange; recording a new host is the only
 * I/O and happens in the background, never blocking or failing the handshake.
 */
export function createHostKeyVerifier(options: HostKeyVerifierOptions): HostKeyVerifier {
  const { host, port, store, log } = options;
  const name = knownHostsName(host, port, options.hostKeyAlias);
  const target = port === 22 ? host : `${host}:${port}`;
  const forget = (entry: KnownHostsEntry) =>
    forgetHostAdvice(entry.file, name, options.platform ?? process.platform);
  let rejection: HostKeyRejection | undefined;
  return {
    algorithms: knownHostKeyAlgorithms(options.entries, name),
    rejection: () => rejection,
    verify: (key) => {
      const verdict = judgeHostKey(options.entries, name, key);
      const fingerprint = hostKeyFingerprint(key);
      switch (verdict.kind) {
        case 'known':
          return true;
        case 'unknown': {
          log?.info('SSH host key: recording first-seen key', { host: target, fingerprint });
          if (options.recordTo) {
            const file = options.recordTo;
            store.append(file, formatKnownHostsLine(name, key)).catch((error: unknown) => {
              log?.warn('SSH host key: could not record first-seen key', {
                host: target,
                file,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          }
          return true;
        }
        case 'changed':
          rejection = {
            verdict,
            message:
              `SSH host key for ${target} has changed: it presented ${hostKeyType(key)} ` +
              `${fingerprint}, but ${verdict.entry.file}:${verdict.entry.line} records ` +
              `${hostKeyFingerprint(verdict.entry.key)}. Refusing to connect. If the host ` +
              `was reinstalled, ${forget(verdict.entry)}`,
          };
          break;
        case 'mismatched-type':
          rejection = {
            verdict,
            message:
              `SSH host key for ${target} has changed: it presented ${hostKeyType(key)} ` +
              `${fingerprint}, but ${verdict.entry.file}:${verdict.entry.line} only ` +
              `records ${verdict.entry.keyType} ${hostKeyFingerprint(verdict.entry.key)}. ` +
              `Refusing to connect. If the host's keys were replaced, ${forget(verdict.entry)}`,
          };
          break;
        case 'revoked':
          rejection = {
            verdict,
            message:
              `SSH host key for ${target} (${fingerprint}) is revoked by ` +
              `${verdict.entry.file}:${verdict.entry.line}. Refusing to connect.`,
          };
          break;
      }
      log?.warn('SSH host key: refused', { host: target, fingerprint, verdict: verdict.kind });
      return false;
    },
  };
}

/**
 * How to drop a host's keys from the file that holds them. The text ends with the
 * `ssh-keygen` command, so copying it picks up no closing quote or full stop. The command
 * is quoted for the shells it is pasted into: POSIX rules, or on Windows double quotes,
 * which cmd.exe (Emdash's default terminal there), PowerShell and Git Bash group alike.
 * When a value holds something one of those still rewrites, only PowerShell's literal
 * single quotes are safe, and the text says so.
 */
function forgetHostAdvice(file: string, name: string, platform: NodeJS.Platform): string {
  const command = (quote: (value: string) => string) =>
    `ssh-keygen -f ${quote(file)} -R ${quote(name)}`;
  if (platform !== 'win32') {
    return `remove the old key with: ${command((value) => quoteArg(value, 'posix'))}`;
  }
  if (!REWRITTEN_IN_DOUBLE_QUOTES.test(file + name)) {
    return `remove the old key with: ${command((value) => `"${value}"`)}`;
  }
  return (
    'remove the old key by running this in PowerShell: ' +
    command((value) => quoteArg(value, 'powershell'))
  );
}

function matchesHashedPattern(pattern: string, name: string): boolean {
  const [, , encodedSalt, encodedHash] = pattern.split('|');
  const salt = encodedSalt ? decodeBase64(encodedSalt) : undefined;
  const hash = encodedHash ? decodeBase64(encodedHash) : undefined;
  if (!salt || !hash) return false;
  const digest = createHmac('sha1', salt).update(name).digest();
  return digest.length === hash.length && timingSafeEqual(digest, hash);
}

function globToRegExp(pattern: string): RegExp | undefined {
  if (!pattern) return undefined;
  const source = lowercaseAscii(pattern)
    .split('')
    .map((char) =>
      char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    )
    .join('');
  return new RegExp(`^${source}$`, 'u');
}

function decodeBase64(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) return undefined;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length > 0 ? decoded : undefined;
}
