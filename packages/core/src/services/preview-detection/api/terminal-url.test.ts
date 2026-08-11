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
});
