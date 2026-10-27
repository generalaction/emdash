import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { SshConnectionFailure } from '@core/primitives/ssh/api/node/connection-control';
import {
  createHostKeyVerifier,
  defaultKnownHostsFiles,
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

  it('knows an identical key, flags a different key of the same type, and ignores other types', () => {
    const recorded = hostKey();
    const entries = parseKnownHosts(line('dev.example.com', recorded), 'f');

    expect(judgeHostKey(entries, names, recorded)).toMatchObject({ kind: 'known' });
    expect(judgeHostKey(entries, names, hostKey())).toMatchObject({
      kind: 'changed',
      entry: { line: 1 },
    });
    expect(judgeHostKey(entries, names, hostKey('ssh-rsa'))).toEqual({ kind: 'unknown' });
    expect(judgeHostKey(entries, knownHostsNames('other.example.com', 22), recorded)).toEqual({
      kind: 'unknown',
    });
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
    expect(rejection?.message).toContain('ssh-keygen -R dev.example.com');
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
