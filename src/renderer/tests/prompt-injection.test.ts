import { describe, expect, it, vi } from 'vitest';
import {
  buildPromptInjectionPayload,
  pastePromptInjection,
} from '@renderer/lib/pty/prompt-injection';

describe('prompt injection', () => {
  it('keeps Claude multiline input unwrapped by default', () => {
    expect(
      buildPromptInjectionPayload({
        providerId: 'claude',
        text: 'Line one\nLine two',
      })
    ).toBe('Line one\nLine two');
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
});
