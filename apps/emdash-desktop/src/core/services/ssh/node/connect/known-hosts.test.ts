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
  hostKeyFingerprint,
  hostKeyType,
  judgeHostKey,
  knownHostKeyAlgorithms,
  knownHostsName,
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

describe('knownHostsName', () => {
  it('is the bare host on port 22 and the bracketed host and port otherwise, in lowercase', () => {
    expect(knownHostsName('Dev.Example.com', 22)).toBe('dev.example.com');
    expect(knownHostsName('Dev.Example.com', 2222)).toBe('[dev.example.com]:2222');
    expect(knownHostsName('::1', 2222)).toBe('[::1]:2222');
  });

  it('is the lowercased HostKeyAlias alone, whatever the port', () => {
    // OpenSSH records "bastion", never "[bastion]:2222": the alias replaces host and port.
    expect(knownHostsName('10.0.0.5', 22, 'Bastion')).toBe('bastion');
    expect(knownHostsName('10.0.0.5', 2222, 'Bastion')).toBe('bastion');
  });

  it('lowercases A-Z only, as OpenSSH does', () => {
    // OpenSSH records this alias as "Ämter.example". Lowercased further, its line is not found.
    expect(knownHostsName('10.0.0.5', 22, 'ÄMTER.Example')).toBe('Ämter.example');
    expect(knownHostsName('ÄMTER.Example', 2222)).toBe('[Ämter.example]:2222');
  });

  it('spells an IPv6 address the short way OpenSSH records it', () => {
    // OpenSSH rewrites the address before it looks it up, whatever was typed.
    expect(knownHostsName('2001:0DB8:0000:0000:0000:0000:0000:0001', 22)).toBe('2001:db8::1');
    expect(knownHostsName('0:0:0:0:0:0:0:1', 2222)).toBe('[::1]:2222');
    expect(knownHostsName('FE80:0:0:0:0:0:0:1%eth0', 22)).toBe('fe80::1%eth0');
    expect(knownHostsName('10.0.0.5', 22)).toBe('10.0.0.5');
  });
});

describe('matchesHostPatterns', () => {
  it('matches plain names, bracketed ports, wildcards, and hashed entries', () => {
    const host = knownHostsName('dev.example.com', 22);
    const hostOnPort = knownHostsName('dev.example.com', 2222);
    expect(matchesHostPatterns(['Dev.Example.com'], host)).toBe(true);
    expect(matchesHostPatterns(['dev.example.com'], hostOnPort)).toBe(false);
    expect(matchesHostPatterns(['[dev.example.com]:2222'], hostOnPort)).toBe(true);
    expect(matchesHostPatterns(['*.example.com'], host)).toBe(true);
    expect(matchesHostPatterns(['dev?example.com'], host)).toBe(true);
    expect(matchesHostPatterns(['dev.example.co'], host)).toBe(false);
    expect(matchesHostPatterns([hashedPattern('dev.example.com')], host)).toBe(true);
    expect(matchesHostPatterns([hashedPattern('[dev.example.com]:2222')], hostOnPort)).toBe(true);
    expect(matchesHostPatterns([hashedPattern('other.example.com')], host)).toBe(false);
  });

  it('does not match a line that spells port 22 in brackets, which OpenSSH never looks up', () => {
    // Blaming such a line would suggest "ssh-keygen -R dev.example.com", which cannot remove it.
    expect(
      matchesHostPatterns(['[dev.example.com]:22'], knownHostsName('dev.example.com', 22))
    ).toBe(false);
  });

  it('lets a negated pattern exclude a line that would otherwise match', () => {
    const name = knownHostsName('dev.example.com', 22);
    expect(matchesHostPatterns(['*.example.com', '!dev.example.com'], name)).toBe(false);
    expect(matchesHostPatterns(['!dev.example.com', '*.example.com'], name)).toBe(false);
    expect(matchesHostPatterns(['*.example.com', '!other.example.com'], name)).toBe(true);
    expect(matchesHostPatterns(['!dev.example.com'], name)).toBe(false);
  });

  it('matches a letter outside A-Z only as written, like ssh-keygen -R', () => {
    const name = knownHostsName('10.0.0.5', 22, 'ÄMTER.Example');
    expect(matchesHostPatterns(['Ämter.Example'], name)).toBe(true);
    expect(matchesHostPatterns([hashedPattern('Ämter.example')], name)).toBe(true);
    // "ssh-keygen -R" could not remove this line, so it must not be blamed either.
    expect(matchesHostPatterns(['ämter.example'], name)).toBe(false);
  });
});

describe('judgeHostKey', () => {
  const name = knownHostsName('dev.example.com', 22);

  it('knows an identical key, flags a different key of the same type, and a different type', () => {
    const recorded = hostKey();
    const entries = parseKnownHosts(line('dev.example.com', recorded), 'f');

    expect(judgeHostKey(entries, name, recorded)).toMatchObject({ kind: 'known' });
    expect(judgeHostKey(entries, name, hostKey())).toMatchObject({
      kind: 'changed',
      entry: { line: 1 },
    });
    // A recorded host offering an algorithm it was never seen with is not "new": that
    // would let an impersonator sidestep the saved key by picking another type.
    expect(judgeHostKey(entries, name, hostKey('ssh-rsa'))).toMatchObject({
      kind: 'mismatched-type',
      entry: { line: 1 },
    });
    expect(judgeHostKey(entries, knownHostsName('other.example.com', 22), recorded)).toEqual({
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
    expect(judgeHostKey(entries, name, hostKey())).toMatchObject({
      kind: 'changed',
      entry: { line: 2 },
    });
    expect(judgeHostKey(entries, name, rsa)).toMatchObject({ kind: 'known', entry: { line: 1 } });
  });

  it('refuses a revoked key even when another line still lists it', () => {
    const key = hostKey();
    const entries = parseKnownHosts(
      [line('dev.example.com', key), line('*', key, '@revoked ')].join('\n'),
      'f'
    );
    expect(judgeHostKey(entries, name, key)).toMatchObject({
      kind: 'revoked',
      entry: { line: 2 },
    });
  });

  it('never treats a certificate authority line as the host key', () => {
    const key = hostKey();
    const entries = parseKnownHosts(line('*.example.com', key, '@cert-authority '), 'f');
    expect(judgeHostKey(entries, name, key)).toEqual({ kind: 'unknown' });
  });
});

describe('knownHostKeyAlgorithms', () => {
  const name = knownHostsName('dev.example.com', 22);

  it('lists the algorithms for the key types on file, in ssh2 order of preference', () => {
    const entries = parseKnownHosts(
      [
        line('dev.example.com', hostKey('ssh-rsa')),
        line('*.example.com', hostKey('ecdsa-sha2-nistp256')),
      ].join('\n'),
      'f'
    );
    expect(knownHostKeyAlgorithms(entries, name)).toEqual([
      'ecdsa-sha2-nistp256',
      'rsa-sha2-512',
      'rsa-sha2-256',
      'ssh-rsa',
    ]);
  });

  it('ignores other hosts, marker lines, and key types ssh2 does not offer by default', () => {
    const entries = parseKnownHosts(
      [
        line('other.example.com', hostKey('ssh-rsa')),
        line('dev.example.com', hostKey(), '@revoked '),
        line('dev.example.com', hostKey(), '@cert-authority '),
        line('dev.example.com', hostKey('ssh-dss')),
      ].join('\n'),
      'f'
    );
    expect(knownHostKeyAlgorithms(entries, name)).toEqual([]);
  });

  it('leaves out a key type whose key on file is revoked', () => {
    // OpenSSH asks this host for its ECDSA key. Asking for the revoked Ed25519 key first
    // would refuse a server that still has a good key on file.
    const revoked = hostKey();
    const entries = parseKnownHosts(
      [
        line('dev.example.com', revoked),
        line('dev.example.com', hostKey('ecdsa-sha2-nistp256')),
        line('*', revoked, '@revoked '),
      ].join('\n'),
      'f'
    );
    expect(knownHostKeyAlgorithms(entries, name)).toEqual(['ecdsa-sha2-nistp256']);
  });

  it('judges a key type by its first key on file, as OpenSSH does', () => {
    const revoked = hostKey();
    const revokedLine = line('dev.example.com', revoked);
    const otherLine = line('dev.example.com', hostKey());
    const rest = [
      line('dev.example.com', hostKey('ecdsa-sha2-nistp256')),
      line('*', revoked, '@revoked '),
    ];
    const algorithms = (lines: string[]) =>
      knownHostKeyAlgorithms(parseKnownHosts(lines.join('\n'), 'f'), name);

    expect(algorithms([revokedLine, otherLine, ...rest])).toEqual(['ecdsa-sha2-nistp256']);
    expect(algorithms([otherLine, revokedLine, ...rest])).toEqual([
      'ssh-ed25519',
      'ecdsa-sha2-nistp256',
    ]);
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

  it('records under the HostKeyAlias alone and finds that line on any port', async () => {
    const key = hostKey();
    const store = memoryStore();
    const verifier = createHostKeyVerifier({
      host: '10.0.0.5',
      port: 2222,
      hostKeyAlias: 'Bastion',
      entries: [],
      recordTo: '/home/u/.ssh/known_hosts',
      store,
    });
    expect(verifier.verify(key)).toBe(true);
    await vi.waitFor(() => expect(store.appended).toHaveLength(1));
    // What OpenSSH writes for the same options: the lowercased alias, no port.
    const recorded = store.appended[0]!.line;
    expect(recorded).toBe(`bastion ssh-ed25519 ${key.toString('base64')}\n`);

    for (const port of [22, 2222]) {
      const next = createHostKeyVerifier({
        host: '10.0.0.5',
        port,
        hostKeyAlias: 'Bastion',
        entries: parseKnownHosts(recorded, '/home/u/.ssh/known_hosts'),
        store: memoryStore(),
      });
      expect(next.verify(key)).toBe(true);
      expect(next.verify(hostKey())).toBe(false);
    }
  });

  it('refuses a changed key for a HostKeyAlias on a non-default port', () => {
    // The line OpenSSH wrote is "bastion ..."; looking up "[bastion]:2222" would miss it
    // and trust whatever key the server presents.
    const recorded = hostKey();
    const verifier = createHostKeyVerifier({
      host: '10.0.0.5',
      port: 2222,
      hostKeyAlias: 'Bastion',
      entries: parseKnownHosts(line(hashedPattern('bastion'), recorded), '/home/u/.ssh/kh'),
      store: memoryStore(),
      platform: 'linux',
    });
    expect(verifier.verify(recorded)).toBe(true);
    expect(verifier.verify(hostKey())).toBe(false);
    expect(verifier.rejection()?.verdict.kind).toBe('changed');
    expect(verifier.rejection()?.message.endsWith('ssh-keygen -f /home/u/.ssh/kh -R bastion')).toBe(
      true
    );
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
      platform: 'linux',
    });

    expect(verifier.verify(presented)).toBe(false);
    expect(store.appended).toEqual([]);
    const rejection = verifier.rejection();
    expect(rejection?.verdict.kind).toBe('changed');
    expect(rejection?.message).toContain(hostKeyFingerprint(presented));
    expect(rejection?.message).toContain(hostKeyFingerprint(recorded));
    expect(rejection?.message).toContain('/home/u/.ssh/known_hosts:1');
  });

  describe('recovery command', () => {
    function adviceFor(options: {
      file: string;
      port?: number;
      platform: NodeJS.Platform;
    }): string {
      const port = options.port ?? 22;
      // Another host comes first, in the file new keys are recorded to. The command must
      // name neither the first file read nor that one, only the file with the stale line.
      const recordTo = '/home/u/.ssh/recorded_here';
      const verifier = createHostKeyVerifier({
        host: 'dev.example.com',
        port,
        entries: [
          ...parseKnownHosts(line('other.example.com', hostKey()), recordTo),
          ...parseKnownHosts(
            line(knownHostsName('dev.example.com', port), hostKey()),
            options.file
          ),
        ],
        recordTo,
        store: memoryStore(),
        platform: options.platform,
      });
      expect(verifier.verify(hostKey())).toBe(false);
      const message = verifier.rejection()!.message;
      return message.slice(message.indexOf('remove the old key'));
    }

    it('names the file that holds the stale line and ends the message, unpunctuated', () => {
      // A custom UserKnownHostsFile: plain "ssh-keygen -R" would edit ~/.ssh/known_hosts.
      // Nothing follows the command, so copying to the end of the text copies only it.
      expect(adviceFor({ file: '/home/u/.ssh/work_hosts', platform: 'linux' })).toBe(
        'remove the old key with: ssh-keygen -f /home/u/.ssh/work_hosts -R dev.example.com'
      );
    });

    it('quotes a bracketed name, which zsh would otherwise reject as a failed glob', () => {
      expect(adviceFor({ file: '/home/u/.ssh/known_hosts', port: 2222, platform: 'darwin' })).toBe(
        "remove the old key with: ssh-keygen -f /home/u/.ssh/known_hosts -R '[dev.example.com]:2222'"
      );
    });

    it('quotes a path a POSIX shell would split or expand', () => {
      expect(adviceFor({ file: "/Users/o'brien/my hosts", platform: 'darwin' })).toBe(
        "remove the old key with: ssh-keygen -f '/Users/o'\\''brien/my hosts' -R dev.example.com"
      );
    });

    it('double-quotes for Windows, where cmd.exe keeps single quotes as part of the value', () => {
      expect(
        adviceFor({
          file: 'C:\\Users\\Jane Doe\\.ssh\\known_hosts',
          port: 2222,
          platform: 'win32',
        })
      ).toBe(
        'remove the old key with: ' +
          'ssh-keygen -f "C:\\Users\\Jane Doe\\.ssh\\known_hosts" -R "[dev.example.com]:2222"'
      );
    });

    it.each([
      [
        'a percent sign',
        'C:\\Users\\me\\50% off\\known_hosts',
        "'C:\\Users\\me\\50% off\\known_hosts'",
      ],
      [
        'a dollar sign',
        'C:\\Users\\pay$x\\.ssh\\known_hosts',
        "'C:\\Users\\pay$x\\.ssh\\known_hosts'",
      ],
      ['a backtick', 'C:\\Users\\a`b\\.ssh\\known_hosts', "'C:\\Users\\a`b\\.ssh\\known_hosts'"],
      [
        'an exclamation mark',
        'C:\\Users\\wow!\\.ssh\\known_hosts',
        'C:\\Users\\wow!\\.ssh\\known_hosts',
      ],
      // Git Bash halves the doubled backslash inside double quotes.
      [
        'a network path',
        '\\\\fs01\\home\\jane\\.ssh\\known_hosts',
        '\\\\fs01\\home\\jane\\.ssh\\known_hosts',
      ],
    ])('names PowerShell when another Windows shell would rewrite %s', (_what, file, argument) => {
      expect(adviceFor({ file, platform: 'win32' })).toBe(
        'remove the old key by running this in PowerShell: ' +
          `ssh-keygen -f ${argument} -R dev.example.com`
      );
    });
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
      platform: 'linux',
    });
    const presented = hostKey('ssh-rsa');

    expect(verifier.verify(presented)).toBe(false);
    expect(store.appended).toEqual([]);
    const rejection = verifier.rejection();
    expect(rejection?.verdict.kind).toBe('mismatched-type');
    expect(rejection?.message).toContain('it presented ssh-rsa');
    expect(rejection?.message).toContain('only records ssh-ed25519');
    expect(
      rejection?.message.endsWith('ssh-keygen -f /home/u/.ssh/known_hosts -R dev.example.com')
    ).toBe(true);
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

  it('expands the system directory placeholder OpenSSH for Windows prints', () => {
    expect(
      defaultKnownHostsFiles(
        'C:\\Users\\me',
        { ProgramData: 'D:\\ProgramData' },
        {
          userKnownHostsFile: [],
          globalKnownHostsFile: ['__PROGRAMDATA__\\ssh/ssh_known_hosts'],
        }
      ).global
    ).toEqual(['D:\\ProgramData\\ssh/ssh_known_hosts']);
  });

  it.skipIf(process.platform === 'win32')('falls back to the OpenSSH defaults', () => {
    expect(defaultKnownHostsFiles('/home/u', {})).toEqual({
      user: ['/home/u/.ssh/known_hosts', '/home/u/.ssh/known_hosts2'],
      global: ['/etc/ssh/ssh_known_hosts', '/etc/ssh/ssh_known_hosts2'],
    });
  });
});
