import { describe, expect, it } from 'vitest';
import { parsePrInput } from '../../renderer/lib/parsePrInput';

describe('parsePrInput', () => {
  it('parses a plain number string', () => {
    expect(parsePrInput('1603')).toBe(1603);
  });

  it('parses a number with whitespace', () => {
    expect(parsePrInput('  1603  ')).toBe(1603);
  });

  it('parses a number with leading hash', () => {
    expect(parsePrInput('#1603')).toBe(1603);
  });

  it('parses a GitHub PR URL', () => {
    expect(parsePrInput('https://github.com/org/repo/pull/1603')).toBe(1603);
  });

  it('parses a GitHub PR URL with trailing slash', () => {
    expect(parsePrInput('https://github.com/org/repo/pull/1603/')).toBe(1603);
  });

  it('parses a GitHub PR URL with extra path segments (files, commits)', () => {
    expect(parsePrInput('https://github.com/org/repo/pull/1603/files')).toBe(1603);
    expect(parsePrInput('https://github.com/org/repo/pull/1603/commits')).toBe(1603);
  });

  it('parses a GitHub Enterprise URL', () => {
    expect(parsePrInput('https://ghe.spotify.net/org/repo/pull/42')).toBe(42);
  });

  it('returns null for empty string', () => {
    expect(parsePrInput('')).toBeNull();
  });

  it('returns null for whitespace-only', () => {
    expect(parsePrInput('   ')).toBeNull();
  });

  it('returns null for non-numeric non-URL input', () => {
    expect(parsePrInput('fix-login-bug')).toBeNull();
  });

  it('returns null for zero', () => {
    expect(parsePrInput('0')).toBeNull();
  });

  it('returns null for negative numbers', () => {
    expect(parsePrInput('-5')).toBeNull();
  });

  it('returns null for a URL that is not a PR', () => {
    expect(parsePrInput('https://github.com/org/repo/issues/1603')).toBeNull();
  });
});
