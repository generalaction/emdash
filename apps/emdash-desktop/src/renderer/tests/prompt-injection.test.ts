import { describe, expect, it, vi } from 'vitest';
import {
  buildPromptInjectionPayload,
  pastePromptInjection,
} from '@core/features/terminals/api/browser/pty/prompt-injection';

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

  it('rejects when the session does not accept the prompt, so callers stop before Enter', async () => {
    const sendInput = vi.fn().mockRejectedValue(new Error('not accepted'));

    await expect(
      pastePromptInjection({ providerId: 'codex', text: 'Review this', sendInput })
    ).rejects.toThrow('not accepted');
  });

  it('can force bracketed paste for single-line file drops', () => {
    expect(
      buildPromptInjectionPayload({
        providerId: undefined,
        text: '/var/folders/example image.png',
        forceBracketedPaste: true,
      })
    ).toBe('\x1b[200~/var/folders/example image.png\x1b[201~');
  });
});
