import { describe, expect, it } from 'vitest';
import { stripUnsolicitedTerminalReplies } from './terminal-reply-filter';

// Background: tmux probes the outer terminal (xterm.js) on every client attach
// with DA1 (`ESC[c`), DA2 (`ESC[>c`) and XTVERSION (`ESC[>q`). Over SSH the
// reply round-trips slowly and lands after tmux's read window, so tmux forwards
// it to the focused pane and the shell echoes garbage like `1;2c0;276;0c`.
// This filter drops those replies on the renderer -> remote input path.

const DA1_REPLY = '\x1b[?1;2c'; // visible tail: 1;2c
const DA2_REPLY = '\x1b[>0;276;0c'; // visible tail: 0;276;0c — xterm.js firmware 276
const XTVERSION_REPLY = '\x1bP>|XTerm(380)\x1b\\';

describe('stripUnsolicitedTerminalReplies', () => {
  it('drops a standalone DA1 reply', () => {
    expect(stripUnsolicitedTerminalReplies(DA1_REPLY)).toBe('');
  });

  it('drops a standalone DA2 reply (xterm.js >0;276;0c)', () => {
    expect(stripUnsolicitedTerminalReplies(DA2_REPLY)).toBe('');
  });

  it('drops a combined DA1+DA2 chunk — the exact leaked pattern', () => {
    expect(stripUnsolicitedTerminalReplies(DA1_REPLY + DA2_REPLY)).toBe('');
  });

  it('drops the repeated leaked pattern seen at the prompt', () => {
    const leaked = (DA1_REPLY + DA2_REPLY).repeat(4);
    expect(stripUnsolicitedTerminalReplies(leaked)).toBe('');
  });

  it('drops an XTVERSION DCS reply', () => {
    expect(stripUnsolicitedTerminalReplies(XTVERSION_REPLY)).toBe('');
  });

  it('forwards ordinary typed input unchanged', () => {
    expect(stripUnsolicitedTerminalReplies('ls -la\r')).toBe('ls -la\r');
  });

  it('forwards a real DA query (ESC[c) unchanged — only replies are dropped', () => {
    expect(stripUnsolicitedTerminalReplies('\x1b[c')).toBe('\x1b[c');
  });

  it('forwards the bare DA2 query (ESC[>c) unchanged — it has no params, so it is not a reply', () => {
    expect(stripUnsolicitedTerminalReplies('\x1b[>c')).toBe('\x1b[>c');
  });

  it('does not touch a cursor-position (CPR) reply', () => {
    expect(stripUnsolicitedTerminalReplies('\x1b[6;10R')).toBe('\x1b[6;10R');
  });

  it('never corrupts a mixed chunk that also carries real input', () => {
    const mixed = 'echo hi' + DA1_REPLY;
    expect(stripUnsolicitedTerminalReplies(mixed)).toBe(mixed);
  });

  it('passes empty input straight through', () => {
    expect(stripUnsolicitedTerminalReplies('')).toBe('');
  });
});
