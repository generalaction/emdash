import { describe, expect, it } from 'vitest';
import { stripAnsi, stripForPromptDetection } from '../../shared/text/stripAnsi';

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

describe('stripForPromptDetection', () => {
  it('strips CSI sequences including private params', () => {
    expect(stripForPromptDetection('\x1b[32mhello\x1b[0m')).toBe('hello');
    expect(stripForPromptDetection('\x1b[?2004h\x1b[?25htext')).toBe('text');
  });

  it('strips BEL-terminated OSC sequences', () => {
    expect(stripForPromptDetection('\x1b]0;title\x07prompt$ ')).toBe('prompt$ ');
  });

  it('strips ST-terminated OSC sequences', () => {
    expect(stripForPromptDetection('\x1b]11;?\x1b\\prompt$ ')).toBe('prompt$ ');
  });

  it('strips DCS sequences', () => {
    expect(stripForPromptDetection('\x1bP+q696e646e\x1b\\prompt$ ')).toBe('prompt$ ');
  });

  it('strips charset designation sequences', () => {
    expect(stripForPromptDetection('\x1b(Btext')).toBe('text');
    expect(stripForPromptDetection('\x1b)0text')).toBe('text');
  });

  it('strips simple ESC sequences', () => {
    expect(stripForPromptDetection('\x1b=\x1b>text\x1bM')).toBe('text');
  });

  it('strips carriage returns', () => {
    expect(stripForPromptDetection('hello\rworld')).toBe('helloworld');
  });

  it('preserves visible text when DCS and mixed OSC terminators are interleaved', () => {
    // This is the core bug: ST-terminated OSC (\x1b]11;?\x1b\\) must be stripped
    // BEFORE BEL-terminated OSC, otherwise the greedy BEL regex matches from the
    // ST-terminated \x1b] across visible text to a distant \x07.
    const fishOutput =
      '\x1b]11;?\x1b\\' + // OSC-ST (background query)
      '\x1bP+q696e646e\x1b\\' + // DCS (capability query)
      'Welcome to fish\r\n' +
      '\x1b]7;file://host/path\x07' + // OSC-BEL (cwd)
      '\x1b]11;?\x1b\\' + // OSC-ST again
      '\x1b]133;A\x1b\\' + // OSC-ST (shell integration)
      '\x1b[92muser\x1b[m@host ~> ' +
      '\x1b]133;B\x07'; // OSC-BEL (shell integration)

    const result = stripForPromptDetection(fishOutput);
    expect(result).toContain('Welcome to fish');
    expect(result).toContain('user@host ~>');
  });
});
