import type { Client } from 'ssh2';
import { describe, expect, it } from 'vitest';
import { SshClientProxy } from './ssh-client-proxy';

describe('SshClientProxy', () => {
  it('throws when the SSH connection is unavailable', () => {
    const proxy = new SshClientProxy('ssh-1');

    expect(() => proxy.client).toThrow('SSH connection is not available');
    expect(proxy.isConnected).toBe(false);
  });

  it('exposes the current client while connected', () => {
    const client = {} as Client;
    const proxy = new SshClientProxy('ssh-1');

    proxy.update(client);

    expect(proxy.client).toBe(client);
    expect(proxy.isConnected).toBe(true);
  });

  it('clears the current client on invalidate', () => {
    const proxy = new SshClientProxy('ssh-1');
    proxy.update({} as Client);

    proxy.invalidate();

    expect(proxy.isConnected).toBe(false);
    expect(() => proxy.client).toThrow('SSH connection is not available');
  });
});
