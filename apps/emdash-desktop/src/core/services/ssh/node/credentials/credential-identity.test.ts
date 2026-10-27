import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { expandSshKeyPath, readSshPrivateKey } from './credential-identity';

afterEach(() => vi.unstubAllEnvs());

it('expands a key path using the OS home directory when HOME is unset', () => {
  vi.stubEnv('HOME', undefined);
  expect(expandSshKeyPath('~')).toBe(homedir());
  expect(expandSshKeyPath('~/.ssh/id_ed25519')).toBe(join(homedir(), '.ssh/id_ed25519'));
});

it.each(['/keys/work', 'C:\\Users\\alice\\.ssh\\id_ed25519', 'keys/work', '~other/key'])(
  'preserves paths without a current-user home prefix: %s',
  (path) => {
    expect(expandSshKeyPath(path)).toBe(path);
  }
);

it.runIf(process.platform === 'win32')('supports the native Windows home prefix', () => {
  expect(expandSshKeyPath('~\\.ssh\\id_ed25519')).toBe(join(homedir(), '.ssh', 'id_ed25519'));
});

it('reads both explicit and inherited keys from the expanded home directory', async () => {
  vi.stubEnv('HOME', undefined);
  const readFile = vi.fn(async () => 'key contents');
  const config = {
    name: 'Work',
    host: 'work.internal',
    port: 22,
    username: 'alice',
    authType: 'key' as const,
  };
  const resolved = {
    hostname: config.host,
    user: config.username,
    port: 22,
    identityFile: ['~/.ssh/id_ed25519'],
    identityAgentDisabled: false,
    identitiesOnly: false,
    forwardAgent: false,
  };
  const explicit = await readSshPrivateKey(
    { ...config, privateKeyPath: '~/.ssh/id_ed25519' },
    undefined,
    readFile
  );
  const inherited = await readSshPrivateKey(config, resolved, readFile);
  expect(readFile).toHaveBeenCalledWith(join(homedir(), '.ssh/id_ed25519'), 'utf-8');
  expect(inherited.fingerprint).toBe(explicit.fingerprint);
});
