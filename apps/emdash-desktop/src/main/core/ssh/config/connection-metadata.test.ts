import { describe, expect, it } from 'vitest';
import { sshConnectionMetadata } from '@shared/core/ssh/ssh-connection-metadata';
import { mergeSshConnectionMetadata, sshConfigFromRow } from './connection-metadata';

describe('SSH connection metadata', () => {
  it('round-trips alias, forward agent, and proxy jump', () => {
    const serialized = sshConnectionMetadata.serialize({
      sshConfigAlias: 'corp-dev',
      forwardAgent: true,
      proxyJump: 'bastion.example.com',
    });

    expect(sshConnectionMetadata.parseJson(serialized)).toEqual({
      sshConfigAlias: 'corp-dev',
      forwardAgent: true,
      proxyJump: 'bastion.example.com',
    });
  });

  it('strips unknown legacy fields on parse', () => {
    const raw = JSON.stringify({ worktreesDir: '/srv/worktrees', sshConfigAlias: 'corp-dev' });
    expect(sshConnectionMetadata.parseJson(raw)).toEqual({ sshConfigAlias: 'corp-dev' });
  });

  it('rejects invalid SSH config aliases before persistence via mergeSshConnectionMetadata', () => {
    expect(() =>
      mergeSshConnectionMetadata(
        {},
        {
          sshConfigAlias: '-oProxyCommand=evil',
        }
      )
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
        metadata: {
          sshConfigAlias: 'corp-dev',
          forwardAgent: true,
          proxyJump: 'bastion',
        },
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

  it('preserves explicit forwardAgent false for manual connections', () => {
    const serialized = sshConnectionMetadata.serialize({ forwardAgent: false });
    expect(sshConnectionMetadata.parseJson(serialized)).toEqual({ forwardAgent: false });
  });
});
