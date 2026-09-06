import { describe, expect, it } from 'vitest';
import { isXtermCapabilityReply } from './xterm-auto-replies';

describe('isXtermCapabilityReply', () => {
  it('matches focus events and xterm.js device-attribute replies', () => {
    expect(isXtermCapabilityReply('\x1b[I')).toBe(true);
    expect(isXtermCapabilityReply('\x1b[O')).toBe(true);
    expect(isXtermCapabilityReply('\x1b[?1;2c')).toBe(true);
    expect(isXtermCapabilityReply('\x1b[>0;276;0c')).toBe(true);
    expect(isXtermCapabilityReply('\x1bP>|xterm.js\x1b\\')).toBe(true);
  });

  it('does not match ordinary typed input', () => {
    expect(isXtermCapabilityReply('ls\r')).toBe(false);
    expect(isXtermCapabilityReply('1;2c')).toBe(false);
    expect(isXtermCapabilityReply('')).toBe(false);
  });
});
