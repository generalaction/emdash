import { describe, expect, it } from 'vitest';
import { normalizeExternalHttpUrl } from './external-url';

describe('normalizeExternalHttpUrl', () => {
  it('removes terminal text after the URL', () => {
    expect(normalizeExternalHttpUrl('https://example.com/path (375')).toBe(
      'https://example.com/path'
    );
    expect(normalizeExternalHttpUrl('https://github.com/acme/repo/pull/593 (375')).toBe(
      'https://github.com/acme/repo/pull/593'
    );
    expect(normalizeExternalHttpUrl('https://example.com/path\t(375')).toBe(
      'https://example.com/path'
    );
  });

  it('removes trailing punctuation commonly printed after URLs', () => {
    expect(normalizeExternalHttpUrl('https://example.com/path,')).toBe('https://example.com/path');
    expect(normalizeExternalHttpUrl('https://example.com/path).')).toBe('https://example.com/path');
  });

  it('preserves balanced trailing parentheses inside URLs', () => {
    expect(
      normalizeExternalHttpUrl('https://en.wikipedia.org/wiki/Lisp_(programming_language)')
    ).toBe('https://en.wikipedia.org/wiki/Lisp_(programming_language)');
  });

  it('preserves query strings and fragments', () => {
    expect(normalizeExternalHttpUrl('https://example.com/path?a=1&b=2#section')).toBe(
      'https://example.com/path?a=1&b=2#section'
    );
  });
});
