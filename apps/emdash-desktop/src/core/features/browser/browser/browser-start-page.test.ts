import { describe, expect, it } from 'vitest';
import { formatServerAddress } from './browser-start-page';

describe('formatServerAddress', () => {
  it('shows host and port for local dev server URLs', () => {
    expect(formatServerAddress('http://localhost:5174/')).toBe('localhost:5174');
  });

  it('omits the port when the URL uses the protocol default', () => {
    expect(formatServerAddress('https://example.localhost/')).toBe('example.localhost');
  });

  it('falls back to the raw URL when parsing fails', () => {
    expect(formatServerAddress('not a url')).toBe('not a url');
  });
});
