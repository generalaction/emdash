import { describe, expect, it } from 'vitest';
import { resolveAuthServerBaseUrl } from './config';

describe('resolveAuthServerBaseUrl', () => {
  it('uses the production auth server without an override', () => {
    expect(resolveAuthServerBaseUrl(undefined, true)).toBe('https://auth.emdash.sh');
    expect(resolveAuthServerBaseUrl('  ', true)).toBe('https://auth.emdash.sh');
  });

  it('accepts an override in development builds', () => {
    expect(resolveAuthServerBaseUrl('http://localhost:8080/', true)).toBe('http://localhost:8080');
    expect(resolveAuthServerBaseUrl('https://auth.example.com/agent/', true)).toBe(
      'https://auth.example.com/agent'
    );
  });

  it('ignores the override in packaged builds', () => {
    expect(resolveAuthServerBaseUrl('http://localhost:8080', false)).toBe('https://auth.emdash.sh');
  });

  it('rejects overrides that are not http(s) URLs', () => {
    expect(() => resolveAuthServerBaseUrl('file:///tmp/auth', true)).toThrow(
      'AGENT_AUTH_SERVER_URL must be an http(s) URL'
    );
    expect(() => resolveAuthServerBaseUrl('localhost:8080', true)).toThrow();
  });
});
