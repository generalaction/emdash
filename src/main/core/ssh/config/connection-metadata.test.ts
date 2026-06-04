import { describe, expect, it } from 'vitest';
import {
  mergeSshConnectionMetadata,
  parseSshConnectionMetadata,
  serializeSshConnectionMetadata,
  sshConfigFromRow,
} from './connection-metadata';

describe('SSH connection metadata', () => {
  it('round-trips alias, forward agent, and proxy jump', () => {
    const serialized = serializeSshConnectionMetadata({
      sshConfigAlias: 'corp-dev',
      forwardAgent: true,
      proxyJump: 'bastion.example.com',
    });

    expect(parseSshConnectionMetadata(serialized)).toEqual({
      sshConfigAlias: 'corp-dev',
      forwardAgent: true,
      proxyJump: 'bastion.example.com',
    });
  });

  it('drops blank strings and malformed JSON instead of leaking invalid metadata', () => {
    expect(
      parseSshConnectionMetadata(
        serializeSshConnectionMetadata({
          sshConfigAlias: '',
          proxyJump: '\t',
        })
      )
    ).toEqual({});
    expect(parseSshConnectionMetadata('{bad json')).toEqual({});
  });

  it('rejects invalid SSH config aliases before persistence', () => {
    expect(() =>
      serializeSshConnectionMetadata({
        sshConfigAlias: '-oProxyCommand=evil',
      })
    ).toThrow('Invalid SSH config alias');

    expect(() =>
      mergeSshConnectionMetadata(
        {},
        {
          sshConfigAlias: 'bad alias',
        }
      )
    ).toThrow('Invalid SSH config alias');
  });

  it('preserves explicit forwardAgent false for manual connections', () => {
    expect(
      parseSshConnectionMetadata(serializeSshConnectionMetadata({ forwardAgent: false }))
    ).toEqual({
      forwardAgent: false,
    });
  });

  it('maps DB rows into shared configs including metadata fields', () => {
    expect(
      sshConfigFromRow({
        id: 'ssh-1',
        name: 'Corp Dev',
        host: 'corp-dev',
        port: 22,
        username: 'alice',
        authType: 'agent',
        privateKeyPath: null,
        useAgent: 1,
        metadata: serializeSshConnectionMetadata({
          sshConfigAlias: 'corp-dev',
          forwardAgent: true,
          proxyJump: 'bastion',
        }),
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z',
      })
    ).toEqual({
      id: 'ssh-1',
      name: 'Corp Dev',
      host: 'corp-dev',
      port: 22,
      username: 'alice',
      authType: 'agent',
      privateKeyPath: undefined,
      useAgent: true,
      sshConfigAlias: 'corp-dev',
      forwardAgent: true,
      proxyJump: 'bastion',
    });
  });

  it('keeps existing metadata when an update omits optional fields', () => {
    expect(
      mergeSshConnectionMetadata(
        {
          sshConfigAlias: 'corp-dev',
          forwardAgent: true,
          proxyJump: 'bastion',
        },
        {}
      )
    ).toEqual({
      sshConfigAlias: 'corp-dev',
      forwardAgent: true,
      proxyJump: 'bastion',
    });
  });

  it('clears existing string metadata when an update explicitly provides undefined', () => {
    expect(
      mergeSshConnectionMetadata(
        {
          sshConfigAlias: 'corp-dev',
          forwardAgent: true,
          proxyJump: 'bastion',
        },
        {
          sshConfigAlias: undefined,
          proxyJump: undefined,
        }
      )
    ).toEqual({
      forwardAgent: true,
    });
  });

  it('ignores legacy worktreesDir metadata', () => {
    expect(
      parseSshConnectionMetadata(
        JSON.stringify({
          worktreesDir: '/srv/worktrees',
          sshConfigAlias: 'corp-dev',
        })
      )
    ).toEqual({
      sshConfigAlias: 'corp-dev',
    });
  });
});
