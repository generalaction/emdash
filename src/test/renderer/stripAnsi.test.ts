import { describe, expect, it } from 'vitest';
import { stripAnsi } from '../../shared/text/stripAnsi';

describe('shared stripAnsi', () => {
  it('strips CSI sequences', () => {
    expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello');
  });

  it('strips private CSI params when enabled', () => {
    expect(stripAnsi('x\x1b[?1;2cy', { includePrivateCsiParams: true })).toBe('xy');
    expect(stripAnsi('x\x1b[?1;2cy')).toBe('x\x1b[?1;2cy');
  });

  it('strips CSI sequences with non-letter final bytes', () => {
    expect(stripAnsi('a\x1b[200~paste\x1b[201~b')).toBe('apasteb');
  });

  it('strips OSC BEL by default', () => {
    expect(stripAnsi('a\x1b]0;title\x07b')).toBe('ab');
  });

  it('strips OSC ST when enabled', () => {
    expect(stripAnsi('a\x1b]0;title\x1b\\b', { stripOscSt: true })).toBe('ab');
    expect(stripAnsi('a\x1b]0;title\x1b\\b')).toBe('a\x1b]0;title\x1b\\b');
  });

  it('can strip carriage returns for classifier/prompt parsing', () => {
    expect(stripAnsi('a\rb', { stripCarriageReturn: true })).toBe('ab');
  });

  it('can strip two-byte escape sequences for provider parsing', () => {
    expect(stripAnsi('x\x1bNz', { stripOtherEscapes: true })).toBe('xz');
    expect(stripAnsi('a\x1bMb', { stripOtherEscapes: true })).toBe('ab');
  });

  it('strips trailing newlines when enabled', () => {
    expect(stripAnsi('hello\r\n', { stripTrailingNewlines: true })).toBe('hello');
    expect(stripAnsi('hello\n\r\n', { stripTrailingNewlines: true })).toBe('hello');
    expect(stripAnsi('hello\nworld\r\n', { stripTrailingNewlines: true })).toBe('hello\nworld');
    expect(stripAnsi('hello\r\n')).toBe('hello\r\n');
  });

  it('does not strip non-escape text when stripOtherEscapes is enabled', () => {
    expect(stripAnsi('hello world', { stripOtherEscapes: true })).toBe('hello world');
    expect(stripAnsi('\x1b[32mhello\x1b[0m', { stripOtherEscapes: true })).toBe('hello');
  });
});
