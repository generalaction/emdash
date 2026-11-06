import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SshConnectionFailure } from '@core/primitives/ssh/api/node/connection-control';
import {
  createHostKeyVerifier,
  defaultKnownHostsFiles,
  fileKnownHostsStore,
  formatKnownHostsLine,
  hostKeyFingerprint,
  hostKeyType,
  judgeHostKey,
  knownHostsNames,
  loadKnownHosts,
  matchesHostPatterns,
  parseKnownHosts,
  type KnownHostsStore,
} from './known-hosts';

/** A public-key blob as ssh2 hands it to the verifier: `string type, string key-data`. */
function hostKey(type = 'ssh-ed25519', material = randomBytes(32)): Buffer {
  const typeBytes = Buffer.from(type, 'latin1');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(typeBytes.length);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(material.length);
  return Buffer.concat([header, typeBytes, length, material]);
}

function line(patterns: string, key: Buffer, marker = ''): string {
  return `${marker}${patterns} ${hostKeyType(key)} ${key.toString('base64')}`;
}

function hashedPattern(name: string): string {
  const salt = randomBytes(20);
  const hash = createHmac('sha1', salt).update(name).digest();
  return `|1|${salt.toString('base64')}|${hash.toString('base64')}`;
}

function memoryStore(files: Record<string, string | Error> = {}): KnownHostsStore & {
  appended: Array<{ path: string; line: string }>;
} {
  const appended: Array<{ path: string; line: string }> = [];
  return {
    appended,
    async read(path) {
      const content = files[path];
      if (content instanceof Error) throw content;
      return content ?? null;
    },
    async append(path, text) {
      appended.push({ path, line: text });
    },
  };
}

describe('parseKnownHosts', () => {
  it('reads markers, patterns, and keys, skipping comments and malformed lines', () => {
    const key = hostKey();
    const entries = parseKnownHosts(
      [
        '# comment',
        '',
        line('a.example.com,10.0.0.1', key),
        line('[b.example.com]:2222', key, '@revoked '),
        line('ca.example.com', key, '@cert-authority '),
        line('bogus.example.com', key, '@unknown-marker '),
        'short.example.com ssh-ed25519',
        `typed.example.com ssh-rsa ${key.toString('base64')}`,
        'junk.example.com ssh-ed25519 not*base64',
      ].join('\n'),
      '/tmp/known_hosts'
    );

    expect(entries.map((entry) => [entry.line, entry.marker, entry.patterns])).toEqual([
      [3, undefined, ['a.example.com', '10.0.0.1']],
      [4, 'revoked', ['[b.example.com]:2222']],
      [5, 'cert-authority', ['ca.example.com']],
    ]);
    expect(entries[0]!.key.equals(key)).toBe(true);
    expect(entries[0]!.file).toBe('/tmp/known_hosts');
  });
});

describe('hostKeyType / hostKeyFingerprint', () => {
  it('reads the algorithm from the blob and rejects truncated or absurd headers', () => {
    expect(hostKeyType(hostKey('ecdsa-sha2-nistp256'))).toBe('ecdsa-sha2-nistp256');
    expect(hostKeyType(Buffer.from([0, 0]))).toBeUndefined();
    expect(hostKeyType(Buffer.from([0, 0, 1, 0, 0x61]))).toBeUndefined();
  });

  it('formats fingerprints like ssh-keygen (SHA256, unpadded base64)', () => {
    expect(hostKeyFingerprint(hostKey())).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/u);
  });
});

describe('matchesHostPatterns', () => {
  it('matches plain names, bracketed ports, wildcards, and hashed entries', () => {
    expect(matchesHostPatterns(['Dev.Example.com'], knownHostsNames('dev.example.com', 22))).toBe(
      true
    );
    expect(
      matchesHostPatterns(['[dev.example.com]:22'], knownHostsNames('dev.example.com', 22))
    ).toBe(true);
    expect(matchesHostPatterns(['dev.example.com'], knownHostsNames('dev.example.com', 2222))).toBe(
      false
    );
    expect(
      matchesHostPatterns(['[dev.example.com]:2222'], knownHostsNames('dev.example.com', 2222))
    ).toBe(true);
    expect(matchesHostPatterns(['*.example.com'], knownHostsNames('dev.example.com', 22))).toBe(
      true
    );
    expect(matchesHostPatterns(['dev?example.com'], knownHostsNames('dev.example.com', 22))).toBe(
      true
    );
    expect(matchesHostPatterns(['dev.example.co'], knownHostsNames('dev.example.com', 22))).toBe(
      false
    );
    expect(
      matchesHostPatterns(
        [hashedPattern('dev.example.com')],
        knownHostsNames('dev.example.com', 22)
      )
    ).toBe(true);
    expect(
      matchesHostPatterns(
        [hashedPattern('[dev.example.com]:2222')],
        knownHostsNames('dev.example.com', 2222)
      )
    ).toBe(true);
    expect(
      matchesHostPatterns(
        [hashedPattern('other.example.com')],
        knownHostsNames('dev.example.com', 22)
      )
    ).toBe(false);
  });

  it('lets a negated pattern exclude a line that would otherwise match', () => {
    const names = knownHostsNames('dev.example.com', 22);
    expect(matchesHostPatterns(['*.example.com', '!dev.example.com'], names)).toBe(false);
    expect(matchesHostPatterns(['!dev.example.com', '*.example.com'], names)).toBe(false);
    expect(matchesHostPatterns(['*.example.com', '!other.example.com'], names)).toBe(true);
    expect(matchesHostPatterns(['!dev.example.com'], names)).toBe(false);
  });
});

describe('judgeHostKey', () => {
  const names = knownHostsNames('dev.example.com', 22);

  it('knows an identical key, flags a different key of the same type, and a different type', () => {
    const recorded = hostKey();
    const entries = parseKnownHosts(line('dev.example.com', recorded), 'f');

    expect(judgeHostKey(entries, names, recorded)).toMatchObject({ kind: 'known' });
    expect(judgeHostKey(entries, names, hostKey())).toMatchObject({
      kind: 'changed',
      entry: { line: 1 },
    });
    // A recorded host offering an algorithm it was never seen with is not "new": that
    // would let an impersonator sidestep the saved key by picking another type.
    expect(judgeHostKey(entries, names, hostKey('ssh-rsa'))).toMatchObject({
      kind: 'mismatched-type',
      entry: { line: 1 },
    });
    expect(judgeHostKey(entries, knownHostsNames('other.example.com', 22), recorded)).toEqual({
      kind: 'unknown',
    });
  });

  it('prefers the same-type line when a host has keys of several types', () => {
    const ed25519 = hostKey();
    const rsa = hostKey('ssh-rsa');
    const entries = parseKnownHosts(
      [line('dev.example.com', rsa), line('dev.example.com', ed25519)].join('\n'),
      'f'
    );
    expect(judgeHostKey(entries, names, hostKey())).toMatchObject({
      kind: 'changed',
      entry: { line: 2 },
    });
    expect(judgeHostKey(entries, names, rsa)).toMatchObject({ kind: 'known', entry: { line: 1 } });
  });

  it('refuses a revoked key even when another line still lists it', () => {
    const key = hostKey();
    const entries = parseKnownHosts(
      [line('dev.example.com', key), line('*', key, '@revoked ')].join('\n'),
      'f'
    );
    expect(judgeHostKey(entries, names, key)).toMatchObject({
      kind: 'revoked',
      entry: { line: 2 },
    });
  });

  it('never treats a certificate authority line as the host key', () => {
    const key = hostKey();
    const entries = parseKnownHosts(line('*.example.com', key, '@cert-authority '), 'f');
    expect(judgeHostKey(entries, names, key)).toEqual({ kind: 'unknown' });
  });
});

describe('loadKnownHosts', () => {
  it('treats a missing file as empty and refuses to connect on any other read failure', async () => {
    const key = hostKey();
    const store = memoryStore({
      '/home/u/.ssh/known_hosts': line('dev.example.com', key),
      '/etc/ssh/ssh_known_hosts': Object.assign(new Error('EACCES: permission denied'), {
        code: 'EACCES',
      }),
    });

    const entries = await loadKnownHosts(['/home/u/.ssh/known_hosts', '/missing'], store);
    expect(entries).toHaveLength(1);

    await expect(
      loadKnownHosts(['/home/u/.ssh/known_hosts', '/etc/ssh/ssh_known_hosts'], store)
    ).rejects.toMatchObject({
      name: 'SshConnectionFailure',
      kind: 'configuration',
      message: expect.stringContaining('/etc/ssh/ssh_known_hosts'),
    } satisfies Partial<SshConnectionFailure>);
  });
});

describe('createHostKeyVerifier', () => {
  it('accepts a known key without touching the store', () => {
    const key = hostKey();
    const store = memoryStore();
    const verifier = createHostKeyVerifier({
      host: 'dev.example.com',
      port: 22,
      entries: parseKnownHosts(line('dev.example.com', key), 'f'),
      recordTo: '/home/u/.ssh/known_hosts',
      store,
    });

    expect(verifier.verify(key)).toBe(true);
    expect(store.appended).toEqual([]);
    expect(verifier.rejection()).toBeUndefined();
  });

  it('accepts a first-seen host and records it in OpenSSH format', async () => {
    const key = hostKey();
    const store = memoryStore();
    const log = { info: vi.fn(), warn: vi.fn() };
    const verifier = createHostKeyVerifier({
      host: 'new.example.com',
      port: 2222,
      entries: [],
      recordTo: '/home/u/.ssh/known_hosts',
      store,
      log: log as never,
    });

    expect(verifier.verify(key)).toBe(true);
    await vi.waitFor(() => expect(store.appended).toHaveLength(1));
    expect(store.appended[0]).toEqual({
      path: '/home/u/.ssh/known_hosts',
      line: `[new.example.com]:2222 ssh-ed25519 ${key.toString('base64')}\n`,
    });
    // The recorded line verifies the same host next time.
    const next = createHostKeyVerifier({
      host: 'new.example.com',
      port: 2222,
      entries: parseKnownHosts(store.appended[0]!.line, 'f'),
      store,
    });
    expect(next.verify(key)).toBe(true);
    expect(next.verify(hostKey())).toBe(false);
    expect(log.info).toHaveBeenCalledWith('SSH host key: recording first-seen key', {
      host: 'new.example.com:2222',
      fingerprint: hostKeyFingerprint(key),
    });
  });

  it('records under the HostKeyAlias and looks the alias up afterwards', async () => {
    const key = hostKey();
    const store = memoryStore();
    const verifier = createHostKeyVerifier({
      host: '10.0.0.5',
      port: 22,
      hostKeyAlias: 'bastion',
      entries: [],
      recordTo: '/home/u/.ssh/known_hosts',
      store,
    });
    expect(verifier.verify(key)).toBe(true);
    await vi.waitFor(() => expect(store.appended).toHaveLength(1));
    expect(store.appended[0]!.line).toBe(formatKnownHostsLine('bastion', 22, key));
  });

  it('refuses a changed key with a message naming both fingerprints and the stale line', () => {
    const recorded = hostKey();
    const presented = hostKey();
    const store = memoryStore();
    const verifier = createHostKeyVerifier({
      host: 'dev.example.com',
      port: 22,
      entries: parseKnownHosts(line('dev.example.com', recorded), '/home/u/.ssh/known_hosts'),
      recordTo: '/home/u/.ssh/known_hosts',
      store,
    });

    expect(verifier.verify(presented)).toBe(false);
    expect(store.appended).toEqual([]);
    const rejection = verifier.rejection();
    expect(rejection?.verdict.kind).toBe('changed');
    expect(rejection?.message).toContain(hostKeyFingerprint(presented));
    expect(rejection?.message).toContain(hostKeyFingerprint(recorded));
    expect(rejection?.message).toContain('/home/u/.ssh/known_hosts:1');
    // The hint must target the file that holds the stale line, not ssh-keygen's default.
    expect(rejection?.message).toContain(
      '"ssh-keygen -f /home/u/.ssh/known_hosts -R dev.example.com"'
    );
  });

  it('quotes the recovery command for files and names the shell would split', () => {
    const recorded = hostKey();
    const verifier = createHostKeyVerifier({
      host: 'dev.example.com',
      port: 2222,
      entries: parseKnownHosts(line('[dev.example.com]:2222', recorded), "/Users/o'brien/kh"),
      store: memoryStore(),
    });
    expect(verifier.verify(hostKey())).toBe(false);
    expect(verifier.rejection()?.message).toContain(
      `"ssh-keygen -f '/Users/o'\\''brien/kh' -R [dev.example.com]:2222"`
    );
  });

  it('refuses a key type the host was never recorded with, and records nothing', () => {
    const recorded = hostKey();
    const store = memoryStore();
    const verifier = createHostKeyVerifier({
      host: 'dev.example.com',
      port: 22,
      entries: parseKnownHosts(line('dev.example.com', recorded), '/home/u/.ssh/known_hosts'),
      recordTo: '/home/u/.ssh/known_hosts',
      store,
    });
    const presented = hostKey('ssh-rsa');

    expect(verifier.verify(presented)).toBe(false);
    expect(store.appended).toEqual([]);
    const rejection = verifier.rejection();
    expect(rejection?.verdict.kind).toBe('mismatched-type');
    expect(rejection?.message).toContain('unexpected type');
    expect(rejection?.message).toContain('only records ssh-ed25519');
    expect(rejection?.message).toContain(hostKeyFingerprint(presented));
  });

  it('looks hostnames up case-insensitively, including hashed lines, and records lowercase', async () => {
    const recorded = hostKey();
    const store = memoryStore();
    const hashed = createHostKeyVerifier({
      host: 'Dev.Example.com',
      port: 22,
      entries: parseKnownHosts(line(hashedPattern('dev.example.com'), recorded), 'f'),
      recordTo: '/home/u/.ssh/known_hosts',
      store,
    });
    expect(hashed.verify(recorded)).toBe(true);
    expect(hashed.verify(hostKey())).toBe(false);
    expect(store.appended).toEqual([]);

    const fresh = createHostKeyVerifier({
      host: 'New.Example.com',
      port: 22,
      entries: [],
      recordTo: '/home/u/.ssh/known_hosts',
      store,
    });
    expect(fresh.verify(recorded)).toBe(true);
    await vi.waitFor(() => expect(store.appended).toHaveLength(1));
    expect(store.appended[0]!.line.startsWith('new.example.com ')).toBe(true);
  });

  it('keeps a HostKeyAlias verbatim rather than lowercasing it', () => {
    const recorded = hostKey();
    const verifier = createHostKeyVerifier({
      host: '10.0.0.5',
      port: 22,
      hostKeyAlias: 'Bastion',
      entries: parseKnownHosts(line(hashedPattern('Bastion'), recorded), 'f'),
      store: memoryStore(),
    });
    expect(verifier.verify(recorded)).toBe(true);
  });

  it('refuses a revoked key', () => {
    const key = hostKey();
    const verifier = createHostKeyVerifier({
      host: 'dev.example.com',
      port: 22,
      entries: parseKnownHosts(line('*', key, '@revoked '), 'f'),
      store: memoryStore(),
    });
    expect(verifier.verify(key)).toBe(false);
    expect(verifier.rejection()?.verdict.kind).toBe('revoked');
  });

  it('still connects when recording the new host fails, but says so', async () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const store: KnownHostsStore = {
      read: async () => null,
      append: async () => {
        throw new Error('EROFS: read-only file system');
      },
    };
    const verifier = createHostKeyVerifier({
      host: 'dev.example.com',
      port: 22,
      entries: [],
      recordTo: '/home/u/.ssh/known_hosts',
      store,
      log: log as never,
    });
    expect(verifier.verify(hostKey())).toBe(true);
    await vi.waitFor(() => expect(log.warn).toHaveBeenCalled());
    expect(log.warn.mock.calls[0]?.[1]).toMatchObject({ error: 'EROFS: read-only file system' });
  });
});

describe('fileKnownHostsStore', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'known-hosts-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('creates the directory and file for a first record', async () => {
    const file = join(root, '.ssh', 'known_hosts');
    expect(await fileKnownHostsStore.read(file)).toBeNull();

    await fileKnownHostsStore.append(file, 'a.example.com ssh-ed25519 AAAA\n');

    expect(await fileKnownHostsStore.read(file)).toBe('a.example.com ssh-ed25519 AAAA\n');
  });

  it('starts a new line when the existing file lacks a trailing newline', async () => {
    const file = join(root, 'known_hosts');
    const record = 'b.example.com ssh-ed25519 BBBB\n';

    await writeFile(file, '# trailing comment without newline');
    await fileKnownHostsStore.append(file, record);
    expect(await readFile(file, 'utf8')).toBe(`# trailing comment without newline\n${record}`);

    const existing = line('a.example.com', hostKey());
    const appended = `${line('b.example.com', hostKey())}\n`;
    await writeFile(file, existing);
    await fileKnownHostsStore.append(file, appended);
    const content = await readFile(file, 'utf8');
    expect(content).toBe(`${existing}\n${appended}`);
    expect(parseKnownHosts(content, file).map((entry) => entry.patterns[0])).toEqual([
      'a.example.com',
      'b.example.com',
    ]);
  });

  it('appends directly after a file that already ends in a newline', async () => {
    const file = join(root, 'known_hosts');
    await writeFile(file, 'a.example.com ssh-ed25519 AAAA\n');
    await fileKnownHostsStore.append(file, 'b.example.com ssh-ed25519 BBBB\n');
    expect(await readFile(file, 'utf8')).toBe(
      'a.example.com ssh-ed25519 AAAA\nb.example.com ssh-ed25519 BBBB\n'
    );
  });
});

describe('defaultKnownHostsFiles', () => {
  it('prefers the files ssh -G resolved, expanding ~ against the given home', () => {
    expect(
      defaultKnownHostsFiles(
        '/home/u',
        {},
        { userKnownHostsFile: ['~/.ssh/kh', '/abs/kh'], globalKnownHostsFile: [] }
      )
    ).toEqual({ user: ['/home/u/.ssh/kh', '/abs/kh'], global: [] });
  });

  it.skipIf(process.platform === 'win32')('falls back to the OpenSSH defaults', () => {
    expect(defaultKnownHostsFiles('/home/u', {})).toEqual({
      user: ['/home/u/.ssh/known_hosts', '/home/u/.ssh/known_hosts2'],
      global: ['/etc/ssh/ssh_known_hosts', '/etc/ssh/ssh_known_hosts2'],
    });
  });
});
