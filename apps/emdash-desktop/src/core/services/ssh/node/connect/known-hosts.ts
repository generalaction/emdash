// OpenSSH known_hosts verification for ssh2 connections. ssh2 accepts any host key
// unless a `hostVerifier` is installed, so trust-on-first-use lives here: a host seen
// before must present the same key, an unseen host is recorded, and a revoked or
// changed key is refused.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Logger } from '@emdash/shared/logger';
import type { SyncHostVerifier } from 'ssh2';
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
  const expand = (file: string) => expandHomePath(file, home);
  const user = resolved?.userKnownHostsFile ?? ['~/.ssh/known_hosts', '~/.ssh/known_hosts2'];
  const global =
    resolved?.globalKnownHostsFile ??
    (process.platform === 'win32'
      ? [join(env.ProgramData ?? 'C:\\ProgramData', 'ssh', 'ssh_known_hosts')]
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
 * The names a host appears under in known_hosts. OpenSSH writes a bare hostname for
 * port 22 and `[host]:port` otherwise; the bracketed form of 22 is accepted too. Pass
 * the name already normalized (see {@link knownHostsLookupName}).
 */
export function knownHostsNames(host: string, port: number): string[] {
  const bracketed = `[${host}]:${port}`;
  return port === 22 ? [host, bracketed] : [bracketed];
}

/**
 * Whether a line's patterns select any of `names`: a hashed pattern must reproduce its
 * HMAC, a plain one is a case-insensitive glob (`*`, `?`), and a `!`-negated match
 * excludes the whole line.
 */
export function matchesHostPatterns(patterns: string[], names: string[]): boolean {
  let matched = false;
  for (const pattern of patterns) {
    if (pattern.startsWith(HASHED_PREFIX)) {
      if (names.some((name) => matchesHashedPattern(pattern, name))) matched = true;
      continue;
    }
    const negated = pattern.startsWith('!');
    const glob = globToRegExp(negated ? pattern.slice(1) : pattern);
    if (!glob || !names.some((name) => glob.test(name))) continue;
    if (negated) return false;
    matched = true;
  }
  return matched;
}

/**
 * The name a destination is looked up and recorded under. DNS names are case-insensitive
 * and OpenSSH lowercases them before hashing or matching, so `Dev.Example.com` must find
 * the hashed line written for `dev.example.com`. A `HostKeyAlias` is an opaque label the
 * user chose and is kept verbatim.
 */
export function knownHostsLookupName(host: string, hostKeyAlias?: string): string {
  return hostKeyAlias ?? host.toLowerCase();
}

/**
 * How `key` relates to the recorded entries for `host:port`. A revoked match wins over
 * everything; otherwise an identical key is known, a different key of the same type is a
 * change, a key of a type the host was never recorded with is a type mismatch, and only
 * a host with no lines at all is a first sighting. The mismatch is refused rather than
 * recorded: with no one to approve it, "offer a different algorithm" would otherwise be
 * a free bypass of every saved key.
 */
export function judgeHostKey(
  entries: readonly KnownHostsEntry[],
  names: string[],
  key: Buffer
): HostKeyVerdict {
  const keyType = hostKeyType(key);
  let known: KnownHostsEntry | undefined;
  let changed: KnownHostsEntry | undefined;
  let otherType: KnownHostsEntry | undefined;
  for (const entry of entries) {
    if (!matchesHostPatterns(entry.patterns, names)) continue;
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

export function formatKnownHostsLine(host: string, port: number, key: Buffer): string {
  const name = port === 22 ? host : `[${host}]:${port}`;
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
  /** Lookup name override (OpenSSH `HostKeyAlias`); the port still applies. */
  hostKeyAlias?: string;
  entries: readonly KnownHostsEntry[];
  /** Where a first-seen key is recorded; omit to accept without recording. */
  recordTo?: string;
  store: KnownHostsStore;
  log?: Logger;
}

export interface HostKeyVerifier {
  verify: SyncHostVerifier;
  /** Set once `verify` refused a key, so the connection error can say why. */
  rejection(): HostKeyRejection | undefined;
}

/**
 * Builds the synchronous ssh2 `hostVerifier`. Entries are loaded up front because ssh2
 * calls the verifier in the middle of key exchange; recording a new host is the only
 * I/O and happens in the background, never blocking or failing the handshake.
 */
export function createHostKeyVerifier(options: HostKeyVerifierOptions): HostKeyVerifier {
  const { host, port, store, log } = options;
  const lookupName = knownHostsLookupName(host, options.hostKeyAlias);
  const names = knownHostsNames(lookupName, port);
  const target = port === 22 ? host : `${host}:${port}`;
  let rejection: HostKeyRejection | undefined;
  return {
    rejection: () => rejection,
    verify: (key) => {
      const verdict = judgeHostKey(options.entries, names, key);
      const fingerprint = hostKeyFingerprint(key);
      switch (verdict.kind) {
        case 'known':
          return true;
        case 'unknown': {
          log?.info('SSH host key: recording first-seen key', { host: target, fingerprint });
          if (options.recordTo) {
            const file = options.recordTo;
            store
              .append(file, formatKnownHostsLine(lookupName, port, key))
              .catch((error: unknown) => {
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
              `${hostKeyFingerprint(verdict.entry.key)}. Refusing to connect; if the host ` +
              `was reinstalled, remove the old line with ` +
              `${forgetHostCommand(verdict.entry.file, names[0]!)}.`,
          };
          break;
        case 'mismatched-type':
          rejection = {
            verdict,
            message:
              `SSH host key for ${target} is of an unexpected type: it presented ` +
              `${hostKeyType(key)} ${fingerprint}, but ${verdict.entry.file}:` +
              `${verdict.entry.line} only records ${verdict.entry.keyType} ` +
              `${hostKeyFingerprint(verdict.entry.key)}. Refusing to connect; if the host ` +
              `really added this key, accept it once from a terminal with ssh, or remove ` +
              `the old line with ${forgetHostCommand(verdict.entry.file, names[0]!)}.`,
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

/** The `ssh-keygen` invocation that drops a host's lines from the file that holds them. */
function forgetHostCommand(file: string, name: string): string {
  return `"ssh-keygen -f ${shellQuote(file)} -R ${shellQuote(name)}"`;
}

function shellQuote(value: string): string {
  return /^[\w./:@[\]-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
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
  const source = pattern
    .split('')
    .map((char) =>
      char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    )
    .join('');
  return new RegExp(`^${source}$`, 'iu');
}

function decodeBase64(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) return undefined;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length > 0 ? decoded : undefined;
}
