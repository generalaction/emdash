import { describe, expect, it } from 'vitest';
import {
  parseSshConnectionMetadata,
  serializeSshConnectionMetadata,
} from '@main/core/ssh/connection-metadata';
import {
  createProxyCommandTransport,
  interpolateProxyCommand,
  normalizeProxyCommand,
} from '@main/core/ssh/proxy-command';

describe('normalizeProxyCommand', () => {
  it('returns undefined for blank values and none', () => {
    expect(normalizeProxyCommand(undefined)).toBeUndefined();
    expect(normalizeProxyCommand('   ')).toBeUndefined();
    expect(normalizeProxyCommand('none')).toBeUndefined();
    expect(normalizeProxyCommand(' NoNe ')).toBeUndefined();
  });

  it('returns a trimmed command', () => {
    expect(normalizeProxyCommand('  cloudflared access ssh --hostname %h  ')).toBe(
      'cloudflared access ssh --hostname %h'
    );
  });
});

describe('interpolateProxyCommand', () => {
  it('expands OpenSSH-style placeholders', () => {
    expect(
      interpolateProxyCommand('ssh jumphost -W %h:%p -l %r %%', {
        host: 'example.com',
        port: 2222,
        username: 'ubuntu',
      })
    ).toBe('ssh jumphost -W example.com:2222 -l ubuntu %');
  });

  it('preserves literal shell metacharacters as plain text during interpolation', () => {
    expect(
      interpolateProxyCommand('cloudflared --hostname=%h $(echo nope)', {
        host: 'example.com',
        port: 2222,
        username: 'ubuntu',
      })
    ).toBe('cloudflared --hostname=example.com $(echo nope)');
  });
});

describe('createProxyCommandTransport', () => {
  it('supports quoted arguments without invoking a shell', async () => {
    const transport = createProxyCommandTransport(
      'python3 -c "import sys; sys.stdout.write(\'ok\\n\'); sys.stdout.flush(); sys.stdin.read(1)"',
      {
        host: 'example.com',
        port: 2222,
        username: 'ubuntu',
      }
    );

    const output = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];

      transport.sock.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        transport.cleanup();
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      transport.sock.on('error', reject);
    });

    expect(output).toContain('ok');
  });

  it('rejects unmatched quotes', () => {
    expect(() =>
      createProxyCommandTransport('python3 -c "print(1)', {
        host: 'example.com',
        port: 2222,
        username: 'ubuntu',
      })
    ).toThrow('unmatched');
  });
});

describe('ssh connection metadata', () => {
  it('serializes and parses proxyCommand and worktreesDir', () => {
    const metadata = serializeSshConnectionMetadata({
      proxyCommand: 'cloudflared access ssh --hostname %h',
      worktreesDir: '/tmp/worktrees',
    });

    expect(parseSshConnectionMetadata(metadata)).toEqual({
      proxyCommand: 'cloudflared access ssh --hostname %h',
      worktreesDir: '/tmp/worktrees',
    });
  });

  it('drops blank proxyCommand values', () => {
    expect(
      parseSshConnectionMetadata(serializeSshConnectionMetadata({ proxyCommand: '   ' }))
    ).toEqual({
      proxyCommand: undefined,
      worktreesDir: undefined,
    });
  });
});
