import { createHash } from 'node:crypto';
import { appendFile, chmod, readFile, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostTrustPrompt } from '../../api/host-trust';
import { connectWithHostTrust } from './host-trust';
import { startTestSshd } from './testing/sshd';

describe.skipIf(process.platform === 'win32')(
  'changed host-key recovery through native OpenSSH',
  () => {
    let server: Awaited<ReturnType<typeof startTestSshd>>;
    let oldKey: string;
    let newKey: string;
    let lookup: string;
    const signal = () => new AbortController().signal;
    const fingerprint = (key: string) =>
      `SHA256:${createHash('sha256')
        .update(Buffer.from(key.split(' ')[1], 'base64'))
        .digest('base64')
        .replace(/=+$/, '')}`;
    beforeAll(async () => {
      server = await startTestSshd();
      oldKey = (await readFile(join(server.directory, 'ca.pub'), 'utf8')).trim();
      newKey = (await readFile(join(server.directory, 'host.pub'), 'utf8')).trim();
      lookup = `[127.0.0.1]:${server.port}`;
    }, 30000);
    beforeEach(async () => {
      await writeFile(
        server.knownHosts,
        `# keep this\n${lookup} ${oldKey}\nother.example ${oldKey}\n`
      );
    });
    afterAll(async () => {
      await server?.close();
    });

    it('replaces only the approved host, preserves other hosts, and reconnects', async () => {
      const confirm = vi.fn(async (_prompt: HostTrustPrompt) => true);
      const session = await connectWithHostTrust(server.config, { signal: signal(), confirm });
      try {
        expect(confirm).toHaveBeenCalledOnce();
        expect(confirm).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: 'changed',
            host: lookup,
            knownHostsFile: server.knownHosts,
            previousFingerprints: [fingerprint(oldKey)],
            fingerprint: fingerprint(newKey),
          })
        );
        expect((await session.exec('printf recovered')).stdout).toBe('recovered');
        const contents = await readFile(server.knownHosts, 'utf8');
        expect(contents).toContain(`# keep this\nother.example ${oldKey}\n`);
        expect(contents).toContain(`${lookup} ${newKey.split(' ').slice(0, 2).join(' ')}`);
      } finally {
        await session.close();
      }
    });

    it('does not alter trust on cancel', async () => {
      const before = await readFile(server.knownHosts, 'utf8');
      await expect(
        connectWithHostTrust(server.config, { signal: signal(), confirm: async () => false })
      ).rejects.toThrow(/host key/i);
      expect(await readFile(server.knownHosts, 'utf8')).toBe(before);
    });

    it('rejects an approval after cancellation', async () => {
      const controller = new AbortController();
      const before = await readFile(server.knownHosts, 'utf8');
      await expect(
        connectWithHostTrust(server.config, {
          signal: controller.signal,
          confirm: async () => {
            controller.abort(new Error('Canceled'));
            return true;
          },
        })
      ).rejects.toThrow('Canceled');
      expect(await readFile(server.knownHosts, 'utf8')).toBe(before);
    });

    it('preserves concurrent edits made during review', async () => {
      await expect(
        connectWithHostTrust(server.config, {
          signal: signal(),
          confirm: async () => {
            await appendFile(server.knownHosts, '# changed elsewhere\n');
            return true;
          },
        })
      ).rejects.toThrow(/changed.*review|changed.*recover/i);
      expect(await readFile(server.knownHosts, 'utf8')).toContain('# changed elsewhere\n');
    });

    it('recovers hashed host entries', async () => {
      server.keygen('-H', '-f', server.knownHosts);
      const session = await connectWithHostTrust(server.config, {
        signal: signal(),
        confirm: async () => true,
      });
      await session.close();
      const contents = await readFile(server.knownHosts, 'utf8');
      expect(contents).not.toContain(lookup);
      expect(contents).toContain(newKey.split(' ')[1]);
    });

    it('preserves other aliases sharing the same known_hosts line', async () => {
      await writeFile(server.knownHosts, `${lookup},keep.example ${oldKey}\n`);
      const session = await connectWithHostTrust(server.config, {
        signal: signal(),
        confirm: async () => true,
      });
      await session.close();
      expect(await readFile(server.knownHosts, 'utf8')).toContain(`keep.example ${oldKey}\n`);
    });

    it('preserves CRLF records and file permissions', async () => {
      await writeFile(
        server.knownHosts,
        `# original comment\r\n${lookup},keep.example ${oldKey}\r\n`
      );
      await chmod(server.knownHosts, 0o600);
      const session = await connectWithHostTrust(server.config, {
        signal: signal(),
        confirm: async () => true,
      });
      await session.close();
      const contents = await readFile(server.knownHosts, 'utf8');
      expect(contents).toContain(`# original comment\r\nkeep.example ${oldKey}\r\n`);
      expect(contents).toMatch(/\r\n$/);
      expect((await stat(server.knownHosts)).mode & 0o777).toBe(0o600);
    });

    it('leaves a deliberately read-only trust file alone', async () => {
      await chmod(server.knownHosts, 0o400);
      const confirm = vi.fn(async () => true);
      try {
        await expect(
          connectWithHostTrust(server.config, { signal: signal(), confirm })
        ).rejects.toThrow(/manual review/i);
        expect(confirm).not.toHaveBeenCalled();
      } finally {
        await chmod(server.knownHosts, 0o600);
      }
    });

    it('uses HostKeyAlias as the trust identity even on a nonstandard port', async () => {
      await writeFile(server.knownHosts, `trusted-work ${oldKey}\n`);
      const config = {
        ...server.config,
        args: ['-o', 'HostKeyAlias=trusted-work', ...server.config.args],
      };
      const confirm = vi.fn(async () => true);
      const session = await connectWithHostTrust(config, { signal: signal(), confirm });
      await session.close();
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ host: 'trusted-work' }));
      expect(await readFile(server.knownHosts, 'utf8')).toContain(
        `trusted-work ${newKey.split(' ').slice(0, 2).join(' ')}`
      );
    });

    it('recovers through an SSH config alias and ProxyCommand', async () => {
      const file = join(server.directory, 'proxy_config');
      await writeFile(
        file,
        [
          'Host recovery-alias',
          'HostName 127.0.0.1',
          `Port ${server.port}`,
          `User ${server.username}`,
          `IdentityFile ${server.key}`,
          'IdentityAgent none',
          `UserKnownHostsFile ${server.knownHosts}`,
          'StrictHostKeyChecking yes',
          `ProxyCommand ssh -F /dev/null -i ${server.key} -o IdentityAgent=none -o UserKnownHostsFile=${server.knownHosts} -o StrictHostKeyChecking=yes -p ${server.port} ${server.username}@127.0.0.1 -W %h:%p`,
          '',
        ].join('\n')
      );
      // The jump host uses a separate, correctly trusted store. Only the target entry is stale.
      const jumpHosts = join(server.directory, 'jump_hosts');
      await writeFile(jumpHosts, `${lookup} ${newKey}\n`);
      await writeFile(
        file,
        (await readFile(file, 'utf8')).replace(
          `-o UserKnownHostsFile=${server.knownHosts}`,
          `-o UserKnownHostsFile=${jumpHosts}`
        )
      );
      const config = {
        ...server.config,
        destination: 'recovery-alias',
        args: ['-F', file, '-T', '-o', 'ControlMaster=no', '-o', 'ControlPath=none'],
      };
      const session = await connectWithHostTrust(config, {
        signal: signal(),
        confirm: async () => true,
      });
      try {
        expect((await session.exec('printf proxied')).stdout).toBe('proxied');
      } finally {
        await session.close();
      }
      expect(await readFile(jumpHosts, 'utf8')).toBe(`${lookup} ${newKey}\n`);
    });

    it('rejects a different key presented after the user reviewed the fingerprint', async () => {
      const replacement = await startTestSshd();
      const file = join(server.directory, 'changing_config');
      const route = (port: number) =>
        [
          'Host work',
          'HostName 127.0.0.1',
          `Port ${port}`,
          `User ${server.username}`,
          `IdentityFile ${server.key}`,
          `UserKnownHostsFile ${server.knownHosts}`,
          'HostKeyAlias pinned-work',
          'StrictHostKeyChecking yes',
          '',
        ].join('\n');
      await writeFile(file, route(server.port));
      await writeFile(server.knownHosts, `pinned-work ${oldKey}\n`);
      const before = await readFile(server.knownHosts, 'utf8');
      const config = { ...server.config, destination: 'work', args: ['-F', file, '-T'] };
      try {
        await expect(
          connectWithHostTrust(config, {
            signal: signal(),
            confirm: async () => {
              await writeFile(file, route(replacement.port));
              return true;
            },
          })
        ).rejects.toThrow(/host key could not be verified/i);
        expect(await readFile(server.knownHosts, 'utf8')).toBe(before);
      } finally {
        await replacement.close();
      }
    });

    it('preserves revocation records and never offers to repair system trust', async () => {
      await writeFile(server.knownHosts, `${lookup} ${oldKey}\n@revoked ${lookup} ${newKey}\n`);
      const confirm = vi.fn(async () => true);
      await expect(
        connectWithHostTrust(server.config, { signal: signal(), confirm })
      ).rejects.toThrow(/revoked/i);
      expect(confirm).not.toHaveBeenCalled();
      await writeFile(server.knownHosts, `${lookup} ${oldKey}\n`);
      const config = {
        ...server.config,
        args: [
          '-o',
          'UserKnownHostsFile=none',
          '-o',
          `GlobalKnownHostsFile=${server.knownHosts}`,
          ...server.config.args,
        ],
      };
      await expect(connectWithHostTrust(config, { signal: signal(), confirm })).rejects.toThrow(
        /manual review/i
      );
      expect(confirm).not.toHaveBeenCalled();
      expect(await readFile(server.knownHosts, 'utf8')).toBe(`${lookup} ${oldKey}\n`);
    });

    it('does not rewrite wildcard trust or revoked host keys', async () => {
      for (const entry of [`* ${oldKey}`, `@revoked ${lookup} ${newKey}`]) {
        await writeFile(server.knownHosts, `${entry}\n`);
        const confirm = vi.fn(async () => true);
        await expect(
          connectWithHostTrust(server.config, { signal: signal(), confirm })
        ).rejects.toThrow(/host key|revoked/i);
        expect(confirm).not.toHaveBeenCalled();
        expect(await readFile(server.knownHosts, 'utf8')).toBe(`${entry}\n`);
      }
    });

    it('does not replace symlinked trust stores', async () => {
      const target = join(server.directory, 'linked_hosts');
      const before = await readFile(server.knownHosts, 'utf8');
      await writeFile(target, before);
      await unlink(server.knownHosts);
      await symlink(target, server.knownHosts);
      try {
        await expect(
          connectWithHostTrust(server.config, { signal: signal(), confirm: async () => true })
        ).rejects.toThrow(/host key|symlink/i);
        expect(await readFile(target, 'utf8')).toBe(before);
      } finally {
        await unlink(server.knownHosts);
      }
    });
  }
);
