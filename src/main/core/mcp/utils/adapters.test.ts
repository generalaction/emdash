import { describe, expect, it } from 'vitest';
import type { ServerMap } from '@shared/mcp/types';
import { adaptForward, adaptReverse } from './adapters';

describe('adaptForward (canonical → agent)', () => {
  const stdioServer = { command: 'npx', args: ['-y', 'foo'] };
  const httpServer = { type: 'http', url: 'https://example.com/mcp', headers: { 'X-Key': 'abc' } };

  describe('passthrough', () => {
    it('returns servers unchanged', () => {
      const servers: ServerMap = { s1: stdioServer, s2: httpServer };
      expect(adaptForward('passthrough', servers)).toEqual(servers);
    });
  });

  describe('gemini', () => {
    it('renames url to httpUrl and adds Accept header for HTTP servers', () => {
      const result = adaptForward('gemini', { s1: httpServer });
      expect(result.s1).toEqual({
        httpUrl: 'https://example.com/mcp',
        headers: { 'X-Key': 'abc', Accept: 'application/json, text/event-stream' },
      });
    });

    it('leaves stdio servers unchanged', () => {
      const result = adaptForward('gemini', { s1: stdioServer });
      expect(result.s1).toEqual(stdioServer);
    });

    it('does not overwrite existing Accept header', () => {
      const server = { type: 'http', url: 'https://x.com', headers: { Accept: 'custom' } };
      const result = adaptForward('gemini', { s1: server });
      expect(result.s1).toMatchObject({ headers: { Accept: 'custom' } });
    });
  });

  describe('cursor', () => {
    it('keeps only url and headers for HTTP servers', () => {
      const result = adaptForward('cursor', { s1: httpServer });
      expect(result.s1).toEqual({ url: 'https://example.com/mcp', headers: { 'X-Key': 'abc' } });
      expect(result.s1).not.toHaveProperty('type');
    });

    it('leaves stdio servers unchanged', () => {
      const result = adaptForward('cursor', { s1: stdioServer });
      expect(result.s1).toEqual(stdioServer);
    });
  });

  describe('codex', () => {
    it('drops HTTP servers', () => {
      const result = adaptForward('codex', { s1: stdioServer, s2: httpServer });
      expect(result.s1).toEqual(stdioServer);
      expect(result.s2).toBeUndefined();
    });
  });

  describe('opencode', () => {
    it('transforms HTTP to remote type with Accept and enabled', () => {
      const result = adaptForward('opencode', { s1: httpServer });
      expect(result.s1).toEqual({
        type: 'remote',
        url: 'https://example.com/mcp',
        headers: { 'X-Key': 'abc', Accept: 'application/json, text/event-stream' },
        enabled: true,
      });
    });

    it('transforms stdio to local type with command array and enabled', () => {
      const result = adaptForward('opencode', { s1: stdioServer });
      expect(result.s1).toEqual({
        type: 'local',
        command: ['npx', '-y', 'foo'],
        enabled: true,
      });
    });
  });

  describe('copilot', () => {
    it('adds tools: ["*"] if missing', () => {
      const result = adaptForward('copilot', { s1: stdioServer });
      expect(result.s1).toHaveProperty('tools', ['*']);
    });

    it('preserves existing tools', () => {
      const server = { ...stdioServer, tools: ['read'] };
      const result = adaptForward('copilot', { s1: server });
      expect(result.s1).toHaveProperty('tools', ['read']);
    });
  });
});

describe('adaptReverse (agent → canonical)', () => {
  describe('passthrough', () => {
    it('returns servers unchanged', () => {
      const servers: ServerMap = { s1: { command: 'npx', args: ['-y', 'foo'] } };
      expect(adaptReverse('passthrough', servers)).toEqual(servers);
    });
  });

  describe('gemini', () => {
    it('renames httpUrl back to url and adds type: http', () => {
      const servers: ServerMap = {
        s1: {
          httpUrl: 'https://example.com',
          headers: { Accept: 'application/json, text/event-stream' },
        },
      };
      const result = adaptReverse('gemini', servers);
      expect(result.s1).toMatchObject({ type: 'http', url: 'https://example.com' });
      expect(result.s1).not.toHaveProperty('httpUrl');
    });

    it('strips injected Accept header during reverse', () => {
      const servers: ServerMap = {
        s1: {
          httpUrl: 'https://example.com',
          headers: { Accept: 'application/json, text/event-stream', 'X-Key': 'abc' },
        },
      };
      const result = adaptReverse('gemini', servers);
      expect(result.s1).toHaveProperty('headers', { 'X-Key': 'abc' });
    });

    it('removes headers entirely when only injected Accept remains', () => {
      const servers: ServerMap = {
        s1: {
          httpUrl: 'https://example.com',
          headers: { Accept: 'application/json, text/event-stream' },
        },
      };
      const result = adaptReverse('gemini', servers);
      expect(result.s1).not.toHaveProperty('headers');
    });

    it('preserves custom Accept header', () => {
      const servers: ServerMap = {
        s1: {
          httpUrl: 'https://example.com',
          headers: { Accept: 'text/html' },
        },
      };
      const result = adaptReverse('gemini', servers);
      expect(result.s1).toHaveProperty('headers', { Accept: 'text/html' });
    });
  });

  describe('cursor', () => {
    it('adds type: http when url is present and no command', () => {
      const servers: ServerMap = { s1: { url: 'https://example.com', headers: {} } };
      const result = adaptReverse('cursor', servers);
      expect(result.s1).toHaveProperty('type', 'http');
    });

    it('leaves stdio servers unchanged', () => {
      const servers: ServerMap = { s1: { command: 'npx', args: ['foo'] } };
      const result = adaptReverse('cursor', servers);
      expect(result.s1).toEqual({ command: 'npx', args: ['foo'] });
    });
  });

  describe('codex', () => {
    it('returns servers as-is (all are stdio)', () => {
      const servers: ServerMap = { s1: { command: 'npx', args: ['foo'] } };
      expect(adaptReverse('codex', servers)).toEqual(servers);
    });
  });

  describe('opencode', () => {
    it('converts remote type back to http canonical', () => {
      const servers: ServerMap = {
        s1: { type: 'remote', url: 'https://example.com', headers: {}, enabled: true },
      };
      const result = adaptReverse('opencode', servers);
      expect(result.s1).toMatchObject({ type: 'http', url: 'https://example.com' });
      expect(result.s1).not.toHaveProperty('enabled');
    });

    it('strips injected Accept header during reverse', () => {
      const servers: ServerMap = {
        s1: {
          type: 'remote',
          url: 'https://example.com',
          headers: { Accept: 'application/json, text/event-stream', 'X-Key': 'abc' },
          enabled: true,
        },
      };
      const result = adaptReverse('opencode', servers);
      expect(result.s1).toHaveProperty('headers', { 'X-Key': 'abc' });
    });

    it('converts local type back to stdio canonical', () => {
      const servers: ServerMap = {
        s1: { type: 'local', command: ['npx', '-y', 'foo'], enabled: true },
      };
      const result = adaptReverse('opencode', servers);
      expect(result.s1).toMatchObject({ command: 'npx', args: ['-y', 'foo'] });
      expect(result.s1).not.toHaveProperty('type');
    });
  });

  describe('copilot', () => {
    it('strips tools: ["*"]', () => {
      const servers: ServerMap = { s1: { command: 'npx', args: ['foo'], tools: ['*'] } };
      const result = adaptReverse('copilot', servers);
      expect(result.s1).not.toHaveProperty('tools');
    });

    it('preserves non-wildcard tools', () => {
      const servers: ServerMap = { s1: { command: 'npx', args: ['foo'], tools: ['read'] } };
      const result = adaptReverse('copilot', servers);
      expect(result.s1).toHaveProperty('tools', ['read']);
    });
  });
});
