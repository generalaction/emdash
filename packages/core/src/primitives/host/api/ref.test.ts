import { describe, expect, it } from 'vitest';
import {
  hostRef,
  hostRefEquals,
  hostRefKey,
  hostRefSchema,
  LOCAL_HOST_REF,
  sshConnectionIdOf,
} from './index';

describe('host refs', () => {
  it('identifies local and remote runtime hosts', () => {
    const remote = hostRef('remote', 'connection-1');

    expect(LOCAL_HOST_REF).toEqual({ type: 'local', id: 'local' });
    expect(remote).toEqual({ type: 'remote', id: 'connection-1' });
    expect(hostRefEquals(remote, { type: 'remote', id: 'connection-1' })).toBe(true);
    expect(hostRefKey(remote)).toBe('remote:connection-1');
    expect(sshConnectionIdOf(remote)).toBe('connection-1');
    expect(sshConnectionIdOf(LOCAL_HOST_REF)).toBeUndefined();
  });

  it('rejects empty and null-containing ids', () => {
    expect(() => hostRef('remote', '')).toThrow('must not be empty');
    expect(hostRefSchema.safeParse({ type: 'remote', id: 'bad\0id' }).success).toBe(false);
  });
});
