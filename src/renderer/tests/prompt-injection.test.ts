import { describe, expect, it, vi } from 'vitest';
import {
  buildPromptInjectionPayload,
  pastePromptInjection,
} from '@renderer/lib/pty/prompt-injection';

describe('prompt injection', () => {
  it("keeps Claude's initial prompt unwrapped because its TUI mishandles bracketed paste at session start", () => {
    expect(
      buildPromptInjectionPayload({
        providerId: 'claude',
        text: 'Line one\nLine two',
        mode: 'initial-prompt',
      })
    ).toBe('Line one\nLine two');
  });

  it('wraps multiline clipboard pastes into Claude so internal newlines do not submit each line early (regression for #1901)', () => {
    const lorem =
      'Contrary to popular belief, Lorem Ipsum is not simply random text.\n\nIt has roots in a piece of classical Latin literature from 45 BC.';
    expect(
      buildPromptInjectionPayload({
        providerId: 'claude',
        text: lorem,
        mode: 'paste',
      })
    ).toBe(`\x1b[200~${lorem}\x1b[201~`);
  });

  it('can force bracketed paste for multiline context blobs', async () => {
    const sendInput = vi.fn().mockResolvedValue(undefined);

    await pastePromptInjection({
      providerId: 'claude',
      text: 'Line one\nLine two',
      forceBracketedPaste: true,
      sendInput,
    });

    expect(sendInput).toHaveBeenCalledWith('\x1b[200~Line one\nLine two\x1b[201~');
  });

  it('can force bracketed paste for single-line file drops', () => {
    expect(
      buildPromptInjectionPayload({
        providerId: undefined,
        text: '/var/folders/example image.png',
        mode: 'paste',
        forceBracketedPaste: true,
      })
    ).toBe('\x1b[200~/var/folders/example image.png\x1b[201~');
  });

  it('preserves a trailing newline so pasted shell commands still auto-execute', () => {
    expect(
      buildPromptInjectionPayload({
        providerId: undefined,
        text: 'ls -la\n',
        mode: 'paste',
      })
    ).toBe('ls -la\n');
  });

  it('preserves leading whitespace on the first line of a multiline paste', () => {
    expect(
      buildPromptInjectionPayload({
        providerId: undefined,
        text: '    def hello():\n        return 1',
        mode: 'paste',
      })
    ).toBe('\x1b[200~    def hello():\n        return 1\x1b[201~');
  });
});
