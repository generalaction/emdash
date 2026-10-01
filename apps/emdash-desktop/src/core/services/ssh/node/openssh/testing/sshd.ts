import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import type { OpenSshConfig } from '../../connect/resolve-ssh-connect-config';

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

/** Real tools, ephemeral keys/configuration, no access to the user's agent or known_hosts. */
export async function startTestSshd(options: { caOnly?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'emdash-openssh-'));
  const children: ChildProcess[] = [];
  const close = async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const stopped = new Promise<void>((resolve) => child.once('close', () => resolve()));
        child.kill('SIGTERM');
        await stopped;
      }
    }
    await rm(directory, { recursive: true, force: true });
  };
  const keygen = (...args: string[]) =>
    execFileSync('ssh-keygen', ['-q', ...args], { stdio: 'pipe' });
  try {
    const executable =
      process.env.EMDASH_TEST_SSHD ||
      execFileSync('sh', ['-c', 'command -v sshd'], { encoding: 'utf8' }).trim();
    if (!executable) throw new Error('Install OpenSSH server to run SSH integration tests');
    const version = spawnSync(executable, ['-V'], { encoding: 'utf8' });
    const match = `${version.stdout} ${version.stderr}`.match(/OpenSSH_(\d+)\.(\d+)/);
    const hasPenalties =
      match && (Number(match[1]) > 9 || (Number(match[1]) === 9 && Number(match[2]) >= 8));
    const key = join(directory, 'identity');
    const hostKey = join(directory, 'host');
    keygen('-t', 'ed25519', '-N', '', '-f', key);
    keygen('-t', 'ed25519', '-N', '', '-f', hostKey);
    keygen('-t', 'ed25519', '-N', '', '-f', join(directory, 'ca'));
    const port = await freePort();
    const username = userInfo().username;
    const configPath = join(directory, 'sshd_config');
    await writeFile(
      configPath,
      [
        `Port ${port}`,
        'ListenAddress 127.0.0.1',
        `HostKey ${hostKey}`,
        'PidFile none',
        'UsePAM no',
        // Rejection tests intentionally make many failed connections from the same loopback IP.
        ...(hasPenalties ? ['PerSourcePenalties no'] : []),
        'StrictModes no',
        'PasswordAuthentication no',
        'KbdInteractiveAuthentication no',
        'PermitRootLogin yes',
        'AllowTcpForwarding yes',
        'AllowStreamLocalForwarding yes',
        'AllowAgentForwarding yes',
        `AuthorizedKeysFile ${options.caOnly ? 'none' : `${key}.pub`}`,
        `TrustedUserCAKeys ${join(directory, 'ca.pub')}`,
        '',
      ].join('\n')
    );
    const child = spawn(executable, ['-D', '-e', '-f', configPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    children.push(child);
    await new Promise<void>((resolve, reject) => {
      let log = '';
      const timer = setTimeout(() => reject(new Error(`sshd startup timeout: ${log}`)), 5000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error(`sshd exited: ${log}`));
      });
      child.stderr!.on('data', (data: Buffer) => {
        log += data.toString();
        if (log.includes('Server listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const knownHosts = join(directory, 'known_hosts');
    await writeFile(knownHosts, `[127.0.0.1]:${port} ${await readFile(`${hostKey}.pub`, 'utf8')}`);
    const config: OpenSshConfig = {
      destination: '127.0.0.1',
      hostname: '127.0.0.1',
      username,
      readyTimeout: 5000,
      env: { ...process.env, SSH_AUTH_SOCK: undefined },
      args: [
        '-F',
        '/dev/null',
        '-T',
        '-p',
        String(port),
        '-l',
        username,
        '-i',
        key,
        '-o',
        'IdentityAgent=none',
        '-o',
        `UserKnownHostsFile=${knownHosts}`,
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        'IdentitiesOnly=yes',
        '-o',
        'PreferredAuthentications=publickey',
      ],
    };
    return { config, directory, key, keygen, port, username, children, close, knownHosts };
  } catch (error) {
    await close();
    throw error;
  }
}
