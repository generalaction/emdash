import { describe, expect, it, vi } from 'vitest';
import { TerminalInputBuffer } from '../../renderer/terminal/TerminalInputBuffer';

describe('TerminalInputBuffer', () => {
  it('captures a message after Enter + confirmSubmit', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('Fix the login page');
    buffer.feed('\r');
    buffer.confirmSubmit();

    expect(onCapture).toHaveBeenCalledWith('Fix the login page');
    expect(buffer.isComplete).toBe(true);
  });

  it('fires callback only once', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('First message here\r');
    buffer.confirmSubmit();

    buffer.feed('Second message here\r');
    buffer.confirmSubmit();

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith('First message here');
  });

  it('handles backspace correctly', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('Hell');
    buffer.feed('\x7f'); // backspace
    buffer.feed('lo world');
    buffer.feed('\r');
    buffer.confirmSubmit();

    expect(onCapture).toHaveBeenCalledWith('Hello world');
  });

  it('strips ANSI escape codes', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('\x1b[32mFix the broken auth\x1b[0m');
    buffer.feed('\r');
    buffer.confirmSubmit();

    expect(onCapture).toHaveBeenCalledWith('Fix the broken auth');
  });

  it('skips slash commands', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('/help\r');
    buffer.confirmSubmit();

    expect(onCapture).not.toHaveBeenCalled();
    expect(buffer.isComplete).toBe(false);
  });

  it('skips single-character confirmations', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('y\r');
    buffer.confirmSubmit();
    expect(onCapture).not.toHaveBeenCalled();

    buffer.feed('ok\r');
    buffer.confirmSubmit();
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('skips short messages under 10 chars', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('fix bug\r');
    buffer.confirmSubmit();

    expect(onCapture).not.toHaveBeenCalled();
    expect(buffer.isComplete).toBe(false);
  });

  it('captures after skipping invalid input', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    // First: short input — should be skipped
    buffer.feed('y\r');
    buffer.confirmSubmit();
    expect(onCapture).not.toHaveBeenCalled();

    // Second: real message — should be captured
    buffer.feed('Implement the authentication flow for OAuth\r');
    buffer.confirmSubmit();
    expect(onCapture).toHaveBeenCalledWith('Implement the authentication flow for OAuth');
  });

  it('does not fire without confirmSubmit', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('Fix the login page\r');
    // No confirmSubmit call
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('ignores feed after completion', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('First message here\r');
    buffer.confirmSubmit();
    expect(buffer.isComplete).toBe(true);

    // Further feeds should be ignored
    buffer.feed('Another message\r');
    expect(onCapture).toHaveBeenCalledTimes(1);
  });
});
