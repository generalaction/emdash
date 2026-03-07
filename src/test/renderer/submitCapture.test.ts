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
});
