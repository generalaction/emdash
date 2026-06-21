import { describe, expect, it } from 'vitest';
import { browserUrlInputText, splitBrowserUrlDisplay } from './browser-url-input';

describe('browserUrlInputText', () => {
  it('hides the internal blank page URL from the toolbar input', () => {
    expect(browserUrlInputText('about:blank')).toBe('');
  });

  it('keeps navigable URLs visible in the toolbar input', () => {
    expect(browserUrlInputText('http://localhost:3000/')).toBe('http://localhost:3000/');
  });
});

describe('splitBrowserUrlDisplay', () => {
  it('returns empty for blank input', () => {
    expect(splitBrowserUrlDisplay('')).toEqual({ kind: 'empty' });
  });

  it('splits http and https URLs into protocol and remainder', () => {
    expect(splitBrowserUrlDisplay('https://klarvoice.com')).toEqual({
      kind: 'web',
      prefix: 'https://',
      remainder: 'klarvoice.com',
    });
    expect(splitBrowserUrlDisplay('http://localhost:3000/docs')).toEqual({
      kind: 'web',
      prefix: 'http://',
      remainder: 'localhost:3000/docs',
    });
  });

  it('splits file URLs into protocol and remainder', () => {
    expect(splitBrowserUrlDisplay('file:///tmp/example.html')).toEqual({
      kind: 'web',
      prefix: 'file://',
      remainder: '/tmp/example.html',
    });
  });

  it('keeps search-like text as plain input', () => {
    expect(splitBrowserUrlDisplay('react docs')).toEqual({
      kind: 'plain',
      text: 'react docs',
    });
  });
});
