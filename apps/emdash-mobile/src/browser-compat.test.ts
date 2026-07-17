import { describe, expect, it, vi } from 'vitest';
import { createMobileUuid, readMobileClipboard, writeMobileClipboard } from './browser-compat';

describe('mobile browser compatibility', () => {
  it('uses native randomUUID when the browser exposes it', () => {
    const uuid = '12345678-1234-4123-8123-123456789abc';
    expect(createMobileUuid({ randomUUID: () => uuid })).toBe(uuid);
  });

  it('builds an RFC 4122 v4 UUID from getRandomValues on an HTTP origin', () => {
    const getRandomValues = vi.fn((values: Uint8Array<ArrayBuffer>) => {
      values.fill(0xff);
      return values;
    });

    expect(createMobileUuid({ getRandomValues })).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it('keeps a UUID-shaped fallback when Web Crypto is unavailable', () => {
    expect(createMobileUuid(null, () => 0)).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('falls back to a paste prompt when clipboard reads are unavailable', async () => {
    const prompt = vi.fn(() => 'pasted text');
    await expect(readMobileClipboard({ prompt })).resolves.toBe('pasted text');
    expect(prompt).toHaveBeenCalledWith('Paste text to send to the terminal:', '');
  });

  it('falls back when the Clipboard API rejects a read', async () => {
    const prompt = vi.fn(() => 'manual paste');
    await expect(
      readMobileClipboard({
        clipboard: { readText: () => Promise.reject(new Error('NotAllowedError')) },
        prompt,
      })
    ).resolves.toBe('manual paste');
  });

  it('uses legacy copy when clipboard writes are unavailable', async () => {
    const copyText = vi.fn(() => true);
    await expect(writeMobileClipboard('copy me', { copyText })).resolves.toBe(true);
    expect(copyText).toHaveBeenCalledWith('copy me');
  });

  it('shows a manual copy prompt when scripted copy is blocked', async () => {
    const prompt = vi.fn(() => null);
    await expect(
      writeMobileClipboard('copy me', {
        clipboard: { writeText: () => Promise.reject(new Error('NotAllowedError')) },
        copyText: () => false,
        prompt,
      })
    ).resolves.toBe(false);
    expect(prompt).toHaveBeenCalledWith('Copy this text:', 'copy me');
  });
});
