import { secret } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { SshConfig } from '@core/primitives/ssh/api';
import type { SshConnectionRow } from '@core/services/app-db/node/schema';
import { parseSshGOutput } from '../config/resolve-ssh-config';
import { resolveSshConnectConfig, type SshConnectDeps } from './resolve-ssh-connect-config';

const base: SshConfig = {
  id: 'host',
  name: 'Work',
  host: 'work.example',
  port: 2222,
  username: 'alice',
  authType: 'agent',
};
function deps(output = ''): Partial<SshConnectDeps> {
  return {
    readFile: vi.fn(async () => 'private key contents'),
    getPassword: vi.fn(async () => secret('password-secret', 'test')),
    getPassphrase: vi.fn(async () => secret('passphrase-secret', 'test')),
    resolveSshConfig: vi.fn(async () => parseSshGOutput(output)),
    env: {},
  };
}

describe('OpenSSH connection configuration', () => {
  it('passes a manual destination and explicit account to OpenSSH', async () => {
    const { config } = await resolveSshConnectConfig({ kind: 'transient', config: base }, deps());
    expect(config.destination).toBe('work.example');
    expect(config.args).toEqual(expect.arrayContaining(['-p', '2222', '-l', 'alice']));
    expect(config.args).toContain('PreferredAuthentications=publickey');
  });

  it('lets OpenSSH consume alias certificates, agents, and jump configuration', async () => {
    const dependencies = deps(
      'hostname resolved.example\nuser bob\nport 2200\nidentityagent none\nidentitiesonly yes'
    );
    const { config } = await resolveSshConnectConfig(
      { kind: 'transient', config: { ...base, sshConfigAlias: 'work' } },
      dependencies
    );
    expect(config.destination).toBe('work');
    expect(config.args).toContain('HostName=resolved.example');
    expect(config.args).toEqual(expect.arrayContaining(['-p', '2200', '-l', 'bob']));
    expect(config.args.join(' ')).not.toMatch(/IdentityAgent|IdentitiesOnly/);
    expect(dependencies.readFile).not.toHaveBeenCalled();
  });

  it('keeps password material wrapped and out of arguments and diagnostics', async () => {
    const result = await resolveSshConnectConfig(
      { kind: 'transient', config: { ...base, authType: 'password', password: 'top-secret' } },
      deps()
    );
    expect(result.config.password?.expose()).toBe('top-secret');
    expect(JSON.stringify(result)).not.toContain('top-secret');
    expect(result.config.args).toContain('PreferredAuthentications=password');
  });

  it('refuses to send a saved password after an alias changes destination', async () => {
    const dependencies = deps('hostname other.example\nuser alice\nport 2222');
    await expect(
      resolveSshConnectConfig(
        {
          kind: 'transient',
          config: { ...base, authType: 'password', sshConfigAlias: 'work' },
          previous: { ...base, authType: 'password' },
        },
        dependencies
      )
    ).rejects.toThrow('destination');
    expect(dependencies.getPassword).not.toHaveBeenCalled();
  });

  it('binds retained passphrases to the selected key contents', async () => {
    const dependencies = deps();
    const key = { ...base, authType: 'key' as const, privateKeyPath: '/keys/work key' };
    const first = await resolveSshConnectConfig(
      { kind: 'transient', config: key, previous: key },
      dependencies
    );
    expect(first.config.args).toEqual(expect.arrayContaining(['-i', '/keys/work key']));
    expect(first.config.passphrase?.expose()).toBe('passphrase-secret');
    const firstIdentity = vi.mocked(dependencies.getPassphrase!).mock.calls[0][1];
    vi.mocked(dependencies.readFile!).mockResolvedValue('replacement key');
    await resolveSshConnectConfig({ kind: 'transient', config: key, previous: key }, dependencies);
    expect(vi.mocked(dependencies.getPassphrase!).mock.calls[1][1]).not.toBe(firstIdentity);
  });

  it.each(['-oProxyCommand=bad', 'host\nother', 'host;bad', ''])(
    'rejects unsafe destinations: %j',
    async (host) => {
      await expect(
        resolveSshConnectConfig({ kind: 'transient', config: { ...base, host } }, deps())
      ).rejects.toThrow();
    }
  );

  it.each([0, -1, 65536, 1.5, NaN])('rejects invalid ports: %s', async (port) => {
    await expect(
      resolveSshConnectConfig({ kind: 'transient', config: { ...base, port } }, deps())
    ).rejects.toThrow();
  });

  it('preserves a zero connect timeout and explicit disabled keepalives', async () => {
    const { config } = await resolveSshConnectConfig(
      { kind: 'transient', config: { ...base, sshConfigAlias: 'work' } },
      deps('hostname work.example\nuser alice\nport 2222\nconnecttimeout 0\nserveraliveinterval 0')
    );
    expect(config.readyTimeout).toBe(0);
    expect(config.args).toContain('ServerAliveInterval=0');
  });

  it('does not weaken host verification or enable automatic background execution', async () => {
    const { config } = await resolveSshConnectConfig({ kind: 'transient', config: base }, deps());
    // Version-dependent session directives belong to the native backend.
    expect(config.args.join(' ')).not.toMatch(/ForkAfterAuthentication|StdinNull|SessionType/);
    expect(config.args).toContain('PermitLocalCommand=no');
    expect(config.args.join(' ')).not.toMatch(
      /StrictHostKeyChecking=no|UserKnownHostsFile=\/dev\/null/
    );
  });
});

it.each(['persisted', 'edit-test'] as const)(
  'preserves the agent selection of a HostName-only connection (%s)',
  async (kind) => {
    const dependencies = {
      ...deps('hostname work.example\nuser alice\nport 2222'),
      findSshConfigByHostName: vi.fn(async () =>
        parseSshGOutput(
          'hostname work.example\nidentityagent /tmp/legacy-agent.sock\nidentitiesonly yes\nidentityfile /keys/legacy'
        )
      ),
    };
    const row: SshConnectionRow = {
      ...base,
      privateKeyPath: null,
      useAgent: 1,
      metadata: null,
      createdAt: '',
      updatedAt: '',
      shouldConnect: 0,
    };
    const { config } = await resolveSshConnectConfig(
      kind === 'persisted'
        ? { kind: 'persisted', row }
        : { kind: 'transient', config: base, previous: base },
      dependencies
    );
    expect(config.destination).toBe('work.example');
    expect(config.args).toEqual(
      expect.arrayContaining([
        'IdentityAgent=/tmp/legacy-agent.sock',
        'IdentitiesOnly=yes',
        '-i',
        '/keys/legacy',
      ])
    );
    expect(dependencies.findSshConfigByHostName).toHaveBeenCalledWith('work.example');
  }
);
it('does not override an explicit native agent selection for a saved connection', async () => {
  const dependencies = {
    ...deps('hostname work.example\nuser alice\nport 2222\nidentityagent none'),
    findSshConfigByHostName: vi.fn(),
  };
  const row: SshConnectionRow = {
    ...base,
    privateKeyPath: null,
    useAgent: 1,
    metadata: null,
    createdAt: '',
    updatedAt: '',
    shouldConnect: 0,
  };
  const { config } = await resolveSshConnectConfig({ kind: 'persisted', row }, dependencies);
  expect(dependencies.findSshConfigByHostName).not.toHaveBeenCalled();
  expect(config.args.join(' ')).not.toContain('IdentityAgent=');
});
