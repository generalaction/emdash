import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { parseSshConfigFile, resolveSshConfigHost } from './sshConfigParser';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

describe('sshConfigParser', () => {
  it('parses host entries including ProxyJump and ignores wildcard hosts', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(`
Host *.internal
  ProxyJump ignored

Host macstudio
  HostName 10.0.0.55
  User studio
  Port 2222
  IdentityAgent "~/.1password/agent.sock"
  ProxyJump jumpuser@bastion.example.com:2200
`);

    const hosts = await parseSshConfigFile();
    expect(hosts).toEqual([
      {
        host: 'macstudio',
        hostname: '10.0.0.55',
        user: 'studio',
        port: 2222,
        identityAgent: `${homedir()}/.1password/agent.sock`,
        proxyJump: 'jumpuser@bastion.example.com:2200',
      },
    ]);
  });

  it('resolves by Host alias by default', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(`
Host macstudio
  HostName 10.0.0.55
  ProxyJump bastion
`);
    await expect(resolveSshConfigHost('macstudio')).resolves.toMatchObject({
      host: 'macstudio',
      hostname: '10.0.0.55',
      proxyJump: 'bastion',
    });
  });

  it('does not apply reverse HostName matching by default', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(`
Host macstudio
  HostName 10.0.0.55
  ProxyJump bastion
`);
    await expect(resolveSshConfigHost('10.0.0.55')).resolves.toBeUndefined();
  });

  it('can resolve by HostName when explicitly allowed', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(`
Host macstudio
  HostName 10.0.0.55
  ProxyJump bastion
`);
    await expect(
      resolveSshConfigHost('10.0.0.55', { allowHostNameMatch: true })
    ).resolves.toMatchObject({
      host: 'macstudio',
      hostname: '10.0.0.55',
      proxyJump: 'bastion',
    });
  });

  it('resolves hosts declared as multiple aliases in one Host line', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(`
Host macstudio mac-studio
  HostName 100.110.42.38
  User bnjoroge
  ProxyJump tailscalework-claude
`);

    await expect(resolveSshConfigHost('macstudio')).resolves.toMatchObject({
      host: 'macstudio',
      hostname: '100.110.42.38',
      user: 'bnjoroge',
      proxyJump: 'tailscalework-claude',
    });

    vi.mocked(readFile).mockResolvedValueOnce(`
Host macstudio mac-studio
  HostName 100.110.42.38
  User bnjoroge
  ProxyJump tailscalework-claude
`);
    await expect(resolveSshConfigHost('mac-studio')).resolves.toMatchObject({
      host: 'mac-studio',
      hostname: '100.110.42.38',
      user: 'bnjoroge',
      proxyJump: 'tailscalework-claude',
    });
  });
});
