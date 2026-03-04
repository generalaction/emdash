import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────
const readFileMock = vi.fn();

vi.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

// ── imports (after mocks) ──────────────────────────────────────────────
import { parseSshConfigFile, resolveIdentityAgent } from '../../main/utils/sshConfigParser';

describe('parseSshConfigFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses specific host entries', async () => {
    readFileMock.mockResolvedValue(
      [
        'Host myserver',
        '  HostName 10.0.0.1',
        '  User deploy',
        '  Port 2222',
        '  IdentityFile ~/.ssh/id_ed25519',
        '  IdentityAgent ~/custom/agent.sock',
      ].join('\n')
    );

    const hosts = await parseSshConfigFile();
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({
      host: 'myserver',
      hostname: '10.0.0.1',
      user: 'deploy',
      port: 2222,
    });
    expect(hosts[0].identityAgent).toBeDefined();
  });

  it('parses Host * blocks and extracts IdentityAgent', async () => {
    readFileMock.mockResolvedValue(
      [
        'Host *',
        '  IdentityAgent ~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock',
        '',
        'Host myserver',
        '  HostName 10.0.0.1',
        '  User deploy',
      ].join('\n')
    );

    const hosts = await parseSshConfigFile();
    // Should contain both the wildcard and the specific host
    const wildcard = hosts.find((h) => h.host === '*');
    expect(wildcard).toBeDefined();
    expect(wildcard!.identityAgent).toContain('1password');
  });
});

describe('resolveIdentityAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns IdentityAgent from matching specific host', async () => {
    readFileMock.mockResolvedValue(
      ['Host myserver', '  HostName 10.0.0.1', '  IdentityAgent /custom/agent.sock'].join('\n')
    );

    const result = await resolveIdentityAgent('myserver');
    expect(result).toBe('/custom/agent.sock');
  });

  it('falls back to Host * IdentityAgent when no specific host matches', async () => {
    readFileMock.mockResolvedValue(
      [
        'Host *',
        '  IdentityAgent ~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock',
        '',
        'Host otherserver',
        '  HostName 10.0.0.2',
      ].join('\n')
    );

    const result = await resolveIdentityAgent('somehost');
    expect(result).toContain('1password');
  });

  it('prefers specific host IdentityAgent over Host * IdentityAgent', async () => {
    readFileMock.mockResolvedValue(
      [
        'Host *',
        '  IdentityAgent /default/agent.sock',
        '',
        'Host myserver',
        '  HostName 10.0.0.1',
        '  IdentityAgent /specific/agent.sock',
      ].join('\n')
    );

    const result = await resolveIdentityAgent('myserver');
    expect(result).toBe('/specific/agent.sock');
  });

  it('returns undefined when no IdentityAgent anywhere', async () => {
    readFileMock.mockResolvedValue(
      ['Host myserver', '  HostName 10.0.0.1', '  User deploy'].join('\n')
    );

    const result = await resolveIdentityAgent('myserver');
    expect(result).toBeUndefined();
  });

  it('handles SSH_AUTH_SOCK special value in IdentityAgent', async () => {
    // OpenSSH supports IdentityAgent SSH_AUTH_SOCK as a literal token
    // meaning "use the SSH_AUTH_SOCK env var"
    readFileMock.mockResolvedValue(['Host *', '  IdentityAgent SSH_AUTH_SOCK'].join('\n'));

    const result = await resolveIdentityAgent('anyhost');
    // Should return undefined (or the env var value), not the literal string
    // so that the caller falls back to process.env.SSH_AUTH_SOCK
    expect(result).toBeUndefined();
  });

  it('handles IdentityAgent none (disables agent auth)', async () => {
    readFileMock.mockResolvedValue(['Host *', '  IdentityAgent none'].join('\n'));

    const result = await resolveIdentityAgent('anyhost');
    expect(result).toBeUndefined();
  });
});
