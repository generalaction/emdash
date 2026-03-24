import { describe, expect, it } from 'vitest';
import { consumeSubmittedInputChunk } from '../../renderer/terminal/submitCapture';

describe('submit capture', () => {
  it('captures submitted text across CRLF input chunks', () => {
    const result = consumeSubmittedInputChunk({
      currentInput: 'hello world',
      data: '\r\n',
      isNewlineInsert: false,
    });

    expect(result.submittedText).toBe('hello world');
    expect(result.currentInput).toBe('');
  });

  it('ignores newline inserts for submit capture', () => {
    const result = consumeSubmittedInputChunk({
      currentInput: 'hello',
      data: '\n',
      isNewlineInsert: true,
    });

    expect(result.submittedText).toBeNull();
    expect(result.currentInput).toBe('hello\n');
  });

  it('strips CSI with private params while capturing submitted text', () => {
    const result = consumeSubmittedInputChunk({
      currentInput: 'fix',
      data: '\x1b[?1;2c bug\r',
      isNewlineInsert: false,
    });

    expect(result.submittedText).toBe('fix bug');
    expect(result.currentInput).toBe('');
  });

  it('strips OSC ST while capturing submitted text', () => {
    const result = consumeSubmittedInputChunk({
      currentInput: 'fix',
      data: '\x1b]0;title\x1b\\ bug\r',
      isNewlineInsert: false,
    });

    expect(result.submittedText).toBe('fix bug');
    expect(result.currentInput).toBe('');
  });

  it('strips bracketed-paste CSI wrappers while capturing submitted text', () => {
    const result = consumeSubmittedInputChunk({
      currentInput: 'fix',
      data: '\x1b[200~ bug\x1b[201~\r',
      isNewlineInsert: false,
    });

    expect(result.submittedText).toBe('fix bug');
    expect(result.currentInput).toBe('');
  });
});
