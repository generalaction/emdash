import { describe, it, expect, vi } from 'vitest';
import { TerminalInputBuffer } from '../../renderer/terminal/TerminalInputBuffer';

describe('TerminalInputBuffer', () => {
  it('does not fire on feed alone (needs confirmSubmit)', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('Fix the login bug\r');
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('fires when confirmSubmit is called after Enter', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('Fix the login bug\r');
    buffer.confirmSubmit();
    expect(onCapture).toHaveBeenCalledWith('Fix the login bug');
  });

  it('fires only once (one-shot)', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('Fix the first message\r');
    buffer.confirmSubmit();

    buffer.feed('Fix the second message\r');
    buffer.confirmSubmit();

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith('Fix the first message');
  });

  it('combines multi-line paste into one message', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('Fix the login page\rcrash on mobile Safari\r');
    buffer.confirmSubmit();

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith('Fix the login page crash on mobile Safari');
  });

  it('skips slash commands', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('/model\r');
    buffer.confirmSubmit();
    expect(onCapture).not.toHaveBeenCalled();

    buffer.feed('Fix the login bug\r');
    buffer.confirmSubmit();
    expect(onCapture).toHaveBeenCalledWith('Fix the login bug');
  });

  it('skips short confirmations', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('y\r');
    buffer.confirmSubmit();
    expect(onCapture).not.toHaveBeenCalled();

    buffer.feed('ok\r');
    buffer.confirmSubmit();
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('resets pending message after skipped input', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('/help\r');
    buffer.confirmSubmit();

    buffer.feed('Implement user authentication\r');
    buffer.confirmSubmit();
    expect(onCapture).toHaveBeenCalledWith('Implement user authentication');
  });

  it('does nothing after dispose', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.dispose();
    buffer.feed('Fix the login bug\r');
    buffer.confirmSubmit();
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('handles backspace by removing last character', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('Fix the bugg');
    buffer.feed('\x7f');
    buffer.feed('s\r');
    buffer.confirmSubmit();
    expect(onCapture).toHaveBeenCalledWith('Fix the bugs');
  });

  it('does not fire if confirmSubmit is called with no pending message', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.confirmSubmit();
    expect(onCapture).not.toHaveBeenCalled();

    buffer.feed('some text');
    buffer.confirmSubmit();
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('ignores paste-only data (no Enter) even if confirmSubmit is called', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('some pasted content without newline');
    buffer.confirmSubmit();
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('strips ANSI escape sequences including bracketed paste markers', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('\x1b[O\x1b[I\x1b[200~Fix the login bug\x1b[201~\r');
    buffer.confirmSubmit();
    expect(onCapture).toHaveBeenCalledWith('Fix the login bug');
  });

  it('strips CSI sequences (arrow keys, cursor movement)', () => {
    const onCapture = vi.fn();
    const buffer = new TerminalInputBuffer(onCapture);

    buffer.feed('\x1b[AFix the login bug\x1b[B\r');
    buffer.confirmSubmit();
    expect(onCapture).toHaveBeenCalledWith('Fix the login bug');
  });
});
