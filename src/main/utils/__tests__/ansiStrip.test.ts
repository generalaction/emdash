import { describe, it, expect } from 'vitest';
import { stripAnsi, extractLastLines } from '../ansiStrip';

describe('stripAnsi', () => {
  it('removes CSI color codes', () => {
    expect(stripAnsi('\x1b[31mred text\x1b[0m')).toBe('red text');
  });

  it('removes OSC sequences', () => {
    expect(stripAnsi('\x1b]0;title\x07content')).toBe('content');
  });

  it('passes through plain text', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('handles mixed content', () => {
    expect(stripAnsi('\x1b[1m\x1b[32m$ git status\x1b[0m\nOn branch main')).toBe(
      '$ git status\nOn branch main'
    );
  });
});

describe('extractLastLines', () => {
  it('returns last N lines', () => {
    expect(extractLastLines('a\nb\nc\nd\ne', 3)).toBe('c\nd\ne');
  });

  it('returns all lines when N exceeds total', () => {
    expect(extractLastLines('a\nb', 10)).toBe('a\nb');
  });
});
