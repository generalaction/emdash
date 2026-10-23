import { describe, expect, it } from 'vitest';
import { normalizeTerminalHttpUrl } from './terminal-url';

describe('normalizeTerminalHttpUrl', () => {
  it('trims unmatched trailing parentheses from terminal URLs', () => {
    expect(normalizeTerminalHttpUrl('http://localhost:3000/)')).toBe('http://localhost:3000/');
    expect(normalizeTerminalHttpUrl('http://localhost:3000/foo(bar))')).toBe(
      'http://localhost:3000/foo(bar)'
    );
  });

  it('preserves balanced parentheses inside terminal URLs', () => {
    expect(normalizeTerminalHttpUrl('http://localhost:3000/foo(bar)')).toBe(
      'http://localhost:3000/foo(bar)'
    );
  });

  it.each([
    ['http://[::1]', 'http://[::1]'],
    ['http://[::1].', 'http://[::1]'],
    ['http://[::1])', 'http://[::1]'],
    ['https://example.com/?a[0]=1', 'https://example.com/?a[0]=1'],
  ])('preserves balanced brackets: %s', (raw, url) => {
    expect(normalizeTerminalHttpUrl(raw)).toBe(url);
  });

  it.each([
    ['https://example.com/a]', 'https://example.com/a'],
    ['https://example.com/a].', 'https://example.com/a'],
    ['https://example.com/a.]', 'https://example.com/a'],
    ['https://example.com/a.)', 'https://example.com/a'],
  ])('trims unmatched closing brackets and the punctuation they expose: %s', (raw, url) => {
    expect(normalizeTerminalHttpUrl(raw)).toBe(url);
  });
});
