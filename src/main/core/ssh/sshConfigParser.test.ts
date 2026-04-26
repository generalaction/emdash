import { beforeEach, describe, expect, it, vi } from 'vitest';

const readFile = vi.fn();

vi.mock('node:fs/promises', () => ({
  readFile,
}));

vi.mock('node:os', () => ({
  homedir: () => '/Users/tester',
}));

describe('parseSshConfigFile', () => {
  beforeEach(() => {
    readFile.mockReset();
  });

  it('parses ProxyCommand entries from ssh config', async () => {
    readFile.mockResolvedValue(`
Host edge
  HostName edge.example.com
  User ubuntu
  Port 2222
  ProxyCommand cloudflared access ssh --hostname %h
  IdentityFile ~/.ssh/id_ed25519
`);

    const { parseSshConfigFile } = await import('./sshConfigParser');
    await expect(parseSshConfigFile()).resolves.toEqual([
      {
        host: 'edge',
        hostname: 'edge.example.com',
        user: 'ubuntu',
        port: 2222,
        proxyCommand: 'cloudflared access ssh --hostname %h',
        identityFile: '/Users/tester/.ssh/id_ed25519',
      },
    ]);
  });
});
