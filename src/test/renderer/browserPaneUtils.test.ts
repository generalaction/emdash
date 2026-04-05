import { describe, expect, it } from 'vitest';
import {
  isHtmlFile,
  normalizeAddressBarUrl,
  buildFileUrl,
} from '../../renderer/lib/browserPaneUtils';

describe('isHtmlFile', () => {
  it('returns true for .html files', () => {
    expect(isHtmlFile('index.html')).toBe(true);
  });

  it('returns true for .htm files', () => {
    expect(isHtmlFile('report.htm')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isHtmlFile('Page.HTML')).toBe(true);
    expect(isHtmlFile('doc.HTM')).toBe(true);
  });

  it('returns false for non-HTML files', () => {
    expect(isHtmlFile('script.js')).toBe(false);
    expect(isHtmlFile('style.css')).toBe(false);
    expect(isHtmlFile('data.json')).toBe(false);
    expect(isHtmlFile('README.md')).toBe(false);
  });

  it('returns false for filenames containing html but not ending with it', () => {
    expect(isHtmlFile('html-parser.js')).toBe(false);
    expect(isHtmlFile('my.html.bak')).toBe(false);
  });
});

describe('normalizeAddressBarUrl', () => {
  it('preserves http:// URLs', () => {
    expect(normalizeAddressBarUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('preserves https:// URLs', () => {
    expect(normalizeAddressBarUrl('https://example.com')).toBe('https://example.com');
  });

  it('preserves file:// URLs', () => {
    expect(normalizeAddressBarUrl('file:///Users/test/index.html')).toBe(
      'file:///Users/test/index.html'
    );
  });

  it('prepends http:// to bare hostnames', () => {
    expect(normalizeAddressBarUrl('localhost:3000')).toBe('http://localhost:3000');
  });

  it('prepends http:// to bare domain names', () => {
    expect(normalizeAddressBarUrl('example.com')).toBe('http://example.com');
  });

  it('trims whitespace', () => {
    expect(normalizeAddressBarUrl('  https://example.com  ')).toBe('https://example.com');
  });

  it('is case-insensitive for protocol detection', () => {
    expect(normalizeAddressBarUrl('HTTP://example.com')).toBe('HTTP://example.com');
    expect(normalizeAddressBarUrl('FILE:///tmp/test.html')).toBe('FILE:///tmp/test.html');
  });
});

describe('buildFileUrl', () => {
  it('builds a file:// URL from root and relative path', () => {
    expect(buildFileUrl('/Users/test/project', 'src/index.html')).toBe(
      'file:///Users/test/project/src/index.html'
    );
  });

  it('collapses duplicate slashes', () => {
    expect(buildFileUrl('/Users/test/project/', '/src/index.html')).toBe(
      'file:///Users/test/project/src/index.html'
    );
  });

  it('handles root path only', () => {
    expect(buildFileUrl('/Users/test/index.html', '')).toBe('file:///Users/test/index.html');
  });

  it('handles Windows-style root paths', () => {
    expect(buildFileUrl('C:/Users/test/project', 'src/index.html')).toBe(
      'file:///C:/Users/test/project/src/index.html'
    );
  });

  it('normalises Windows backslashes', () => {
    expect(buildFileUrl('C:\\Users\\test\\project', 'src\\index.html')).toBe(
      'file:///C:/Users/test/project/src/index.html'
    );
  });
});
