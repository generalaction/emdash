import { describe, expect, it, vi } from 'vitest';

vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn(), on: vi.fn() },
}));

const { normalizeUrl } = await import('./dev-server-watcher');

describe('normalizeUrl', () => {
  describe('without sshHost', () => {
    it('rewrites 0.0.0.0 to 127.0.0.1', () => {
      expect(normalizeUrl('http://0.0.0.0:3000')).toBe('http://127.0.0.1:3000');
    });

    it('leaves 127.0.0.1 untouched', () => {
      expect(normalizeUrl('http://127.0.0.1:3000/admin')).toBe('http://127.0.0.1:3000/admin');
    });

    it('leaves localhost untouched', () => {
      expect(normalizeUrl('http://localhost:3000')).toBe('http://localhost:3000');
    });
  });

  describe('with sshHost', () => {
    it('rewrites 127.0.0.1 hostname while keeping port and path', () => {
      expect(normalizeUrl('http://127.0.0.1:3000/admin', 'remote.example.com')).toBe(
        'http://remote.example.com:3000/admin'
      );
    });

    it('rewrites localhost hostname', () => {
      expect(normalizeUrl('http://localhost:3000', 'remote.example.com')).toBe(
        'http://remote.example.com:3000/'
      );
    });

    it('rewrites 0.0.0.0 hostname', () => {
      expect(normalizeUrl('http://0.0.0.0:51710', 'remote.example.com')).toBe(
        'http://remote.example.com:51710/'
      );
    });

    it('rewrites to an IPv4 SSH host', () => {
      expect(normalizeUrl('http://127.0.0.1:3000', '203.0.113.7')).toBe('http://203.0.113.7:3000/');
    });

    it('rewrites to a plain IPv6 SSH host (URL class adds brackets)', () => {
      expect(normalizeUrl('http://127.0.0.1:3000', '2001:db8::1')).toBe(
        'http://[2001:db8::1]:3000/'
      );
    });

    it('falls back to the raw URL when the input is unparseable', () => {
      expect(normalizeUrl('not a url', 'remote.example.com')).toBe('not a url');
    });
  });
});
