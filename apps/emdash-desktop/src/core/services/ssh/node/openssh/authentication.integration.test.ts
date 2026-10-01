import { execFileSync, spawn } from 'node:child_process';
import { access, appendFile, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { secret } from '@emdash/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveSshConfig, createExecFileSshConfigRunner } from '../config/resolve-ssh-config';
import { resolveSshConnectConfig } from '../connect/resolve-ssh-connect-config';
import { sshKeyFingerprint } from '../credentials/credential-identity';
import { connectOpenSsh } from './session';
import { startTestSshd } from './testing/sshd';

describe.skipIf(process.platform === 'win32')(
  'native OpenSSH authentication and configuration',
  () => {
    let server: Awaited<ReturnType<typeof startTestSshd>>;
    beforeAll(async () => {
      server = await startTestSshd({ caOnly: true });
    }, 30000);
    afterAll(async () => {
      await server?.close();
    });
    it.for(
      ['ed25519', 'ecdsa', 'rsa'].flatMap((type) =>
        [false, true].map((identitiesOnly) => ({ type, identitiesOnly }))
      )
    )(
      'authenticates $type agent certificates to a CA-only host (IdentitiesOnly $identitiesOnly)',
      { timeout: 30000 },
      async ({ type, identitiesOnly }) => {
        const prefix = `${type}-${identitiesOnly}`;
        const key = join(server.directory, prefix);
        server.keygen('-t', type, '-N', '', '-f', key);
        server.keygen(
          '-s',
          join(server.directory, 'ca'),
          '-I',
          prefix,
          '-n',
          server.username,
          '-V',
          '-5m:+1h',
          `${key}.pub`
        );
        const socket = join(server.directory, `${prefix}.sock`);
        const agent = spawn('ssh-agent', ['-D', '-a', socket], { stdio: 'ignore' });
        server.children.push(agent);
        await vi.waitFor(async () => {
          await access(socket);
        });
        const env = { ...process.env, SSH_AUTH_SOCK: socket };
        execFileSync('ssh-add', [key], { env, stdio: 'pipe' });
        // Only the agent can sign: keep the public key/certificate but remove the private key.
        await rename(key, `${key}.agent-only`);
        const configFile = join(server.directory, `${prefix}.config`);
        await writeFile(
          configFile,
          [
            'Host cert-host',
            `HostName 127.0.0.1`,
            `User ${server.username}`,
            `Port ${server.port}`,
            `IdentityAgent ${socket}`,
            `IdentityFile ${key}`,
            `IdentitiesOnly ${identitiesOnly ? 'yes' : 'no'}`,
            `UserKnownHostsFile ${server.knownHosts}`,
            'StrictHostKeyChecking yes',
            '',
          ].join('\n')
        );
        const resolved = await resolveSshConnectConfig(
          {
            kind: 'transient',
            config: {
              id: 'certificate',
              name: 'Certificate',
              host: 'ignored',
              username: 'ignored',
              port: 22,
              authType: 'agent',
              sshConfigAlias: 'cert-host',
            },
          },
          {
            env,
            resolveSshConfig: (alias) =>
              resolveSshConfig(alias, {
                runner: createExecFileSshConfigRunner({ extraArgs: ['-F', configFile] }),
              }),
          }
        );
        resolved.config.args.unshift('-F', configFile);
        const session = await connectOpenSsh(resolved.config);
        try {
          expect((await session.exec('printf certificate-ok')).stdout).toBe('certificate-ok');
        } finally {
          await session.close();
        }
      }
    );
    it('rejects the corresponding bare key on a certificate-only host', async () => {
      await expect(connectOpenSsh(server.config)).rejects.toThrow(/permission denied/i);
    });
  }
);

describe.skipIf(process.platform === 'win32')('host trust and encrypted private keys', () => {
  let server: Awaited<ReturnType<typeof startTestSshd>>;
  beforeAll(async () => {
    server = await startTestSshd();
  }, 30000);
  afterAll(async () => {
    await server?.close();
  });
  it('answers an actual encrypted-key prompt through the credential broker', async () => {
    const key = join(server.directory, 'encrypted');
    server.keygen('-t', 'ed25519', '-N', 'protected-key', '-f', key);
    await appendFile(`${server.key}.pub`, await readFile(`${key}.pub`, 'utf8'));
    const args = [...server.config.args];
    args[args.indexOf('-i') + 1] = key;
    const session = await connectOpenSsh({
      ...server.config,
      args,
      keyPath: key,
      keyFingerprint: sshKeyFingerprint(key, await readFile(key, 'utf8')),
      passphrase: secret('protected-key', 'test'),
    });
    try {
      expect((await session.exec('printf unlocked')).stdout).toBe('unlocked');
    } finally {
      await session.close();
    }
  });
  it('asks before trusting a new host and persists the accepted key through OpenSSH', async () => {
    const knownHosts = join(server.directory, 'new_known_hosts');
    await writeFile(knownHosts, '');
    const args = server.config.args.map((arg) =>
      arg.startsWith('UserKnownHostsFile=')
        ? `UserKnownHostsFile=${knownHosts}`
        : arg === 'StrictHostKeyChecking=yes'
          ? 'StrictHostKeyChecking=ask'
          : arg
    );
    const confirmHost = vi.fn(async () => true);
    const session = await connectOpenSsh({ ...server.config, args }, { confirmHost });
    try {
      expect(confirmHost).toHaveBeenCalledOnce();
      expect(await readFile(knownHosts, 'utf8')).toContain('ssh-ed25519');
    } finally {
      await session.close();
    }
  });
  it('never overrides a changed host key', async () => {
    const knownHosts = join(server.directory, 'wrong_known_hosts');
    await writeFile(
      knownHosts,
      `[127.0.0.1]:${server.port} ${await readFile(join(server.directory, 'ca.pub'), 'utf8')}`
    );
    const args = server.config.args.map((arg) =>
      arg.startsWith('UserKnownHostsFile=') ? `UserKnownHostsFile=${knownHosts}` : arg
    );
    const confirmHost = vi.fn(async () => true);
    await expect(connectOpenSsh({ ...server.config, args }, { confirmHost })).rejects.toThrow(
      /HOST IDENTIFICATION HAS CHANGED/
    );
    expect(confirmHost).not.toHaveBeenCalled();
  });
});

describe.skipIf(process.platform === 'win32')('native SSH proxy configuration', () => {
  let server: Awaited<ReturnType<typeof startTestSshd>>;
  beforeAll(async () => {
    server = await startTestSshd();
  }, 30000);
  afterAll(async () => {
    await server?.close();
  });
  it.each(['ProxyJump', 'ProxyCommand'])(
    'connects through an alias using %s',
    async (directive) => {
      const file = join(server.directory, `${directive}.config`);
      await writeFile(
        file,
        [
          'Host target',
          directive === 'ProxyJump'
            ? '  ProxyJump jump'
            : `  ProxyCommand ssh -F ${file} -W %h:%p jump`,
          'Host target jump',
          `  HostName 127.0.0.1`,
          `  User ${server.username}`,
          `  Port ${server.port}`,
          `  IdentityFile ${server.key}`,
          '  IdentityAgent none',
          '  IdentitiesOnly yes',
          `  UserKnownHostsFile ${server.knownHosts}`,
          '  StrictHostKeyChecking yes',
          '',
        ].join('\n')
      );
      const resolved = await resolveSshConnectConfig(
        {
          kind: 'transient',
          config: {
            id: 'proxy',
            name: 'Proxy',
            host: 'unused',
            username: 'unused',
            port: 22,
            authType: 'agent',
            sshConfigAlias: 'target',
          },
        },
        {
          resolveSshConfig: (alias) =>
            resolveSshConfig(alias, {
              runner: createExecFileSshConfigRunner({ extraArgs: ['-F', file] }),
            }),
        }
      );
      resolved.config.args.unshift('-F', file);
      const session = await connectOpenSsh(resolved.config);
      try {
        expect((await session.exec('printf jumped')).stdout).toBe('jumped');
      } finally {
        await session.close();
      }
    }
  );
});

// Optional password fixture: the repository's remote-machine Docker image, mapped to this port.
// Kept opt-in so the standard certificate/host-trust suite needs only local OpenSSH tools.
describe.skipIf(!process.env.EMDASH_TEST_PASSWORD_SSH_PORT)(
  'OpenSSH password authentication',
  () => {
    let directory: string;
    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), 'emdash-password-'));
    });
    afterAll(async () => {
      if (directory) await rm(directory, { recursive: true, force: true });
    });
    async function profile(password: string) {
      const { config } = await resolveSshConnectConfig({
        kind: 'transient',
        config: {
          id: 'password',
          name: 'Docker password fixture',
          host: '127.0.0.1',
          username: 'devuser',
          port: Number(process.env.EMDASH_TEST_PASSWORD_SSH_PORT),
          authType: 'password',
          password,
        },
      });
      config.args.unshift(
        '-F',
        '/dev/null',
        '-o',
        `UserKnownHostsFile=${join(directory, 'known_hosts')}`,
        '-o',
        'StrictHostKeyChecking=accept-new'
      );
      return config;
    }
    it.each([true, false])(
      'uses the broker for real password authentication (multiplex: %s)',
      async (multiplex) => {
        const session = await connectOpenSsh(await profile('devpass'), { multiplex });
        try {
          expect((await session.exec('printf password-ok')).stdout).toBe('password-ok');
        } finally {
          await session.close();
        }
      }
    );
    it('rejects an incorrect password without repeatedly prompting', async () => {
      await expect(connectOpenSsh(await profile('wrong-password'))).rejects.toThrow(
        /Permission denied/i
      );
    }, 15000);
  }
);
