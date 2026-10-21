import { describe, expect, it, vi } from 'vitest';
import {
  buildPromptPointerMessage,
  cleanupStalePromptSpills,
  spillLargePrompt,
} from './prompt-spill';

describe('TUI prompt spilling', () => {
  it('keeps short prompts inline', async () => {
    const createTempDir = vi.fn();

    await expect(spillLargePrompt('short', { maxChars: 5, createTempDir })).resolves.toEqual({
      prompt: 'short',
      spilled: false,
      cleanup: expect.any(Function),
    });
    expect(createTempDir).not.toHaveBeenCalled();
  });

  it('writes large prompts to Host temp storage and removes them on cleanup', async () => {
    const writeContextFile = vi.fn(async () => undefined);
    const removeTempDir = vi.fn(async () => undefined);
    const result = await spillLargePrompt('large prompt', {
      maxChars: 5,
      createTempDir: async () => '/host/tmp/emdash-tui-prompt-abc',
      writeContextFile,
      removeTempDir,
    });

    expect(result.prompt).toBe(
      buildPromptPointerMessage('/host/tmp/emdash-tui-prompt-abc/task-context.md')
    );
    expect(result.spilled).toBe(true);
    expect(writeContextFile).toHaveBeenCalledWith(
      '/host/tmp/emdash-tui-prompt-abc/task-context.md',
      'large prompt'
    );

    await result.cleanup();
    expect(removeTempDir).toHaveBeenCalledWith('/host/tmp/emdash-tui-prompt-abc');
  });

  it('falls back to the inline prompt when Host storage fails', async () => {
    const onError = vi.fn();

    await expect(
      spillLargePrompt('large prompt', {
        maxChars: 5,
        createTempDir: async () => {
          throw new Error('disk unavailable');
        },
        onError,
      })
    ).resolves.toMatchObject({ prompt: 'large prompt', spilled: false });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'large prompt'.length);
  });

  it('removes only stale TUI prompt directories after a crash', async () => {
    const removeTempEntry = vi.fn(async () => undefined);
    await cleanupStalePromptSpills({
      now: () => 100_000_000,
      listTempEntries: async () => [
        { name: 'emdash-tui-prompt-stale', isDirectory: true },
        { name: 'emdash-tui-prompt-active', isDirectory: true },
        { name: 'unrelated', isDirectory: true },
        { name: 'emdash-tui-prompt-file', isDirectory: false },
      ],
      statTempEntry: async (name) => ({
        mtimeMs: name.endsWith('stale') ? 0 : 100_000_000,
      }),
      removeTempEntry,
    });

    expect(removeTempEntry).toHaveBeenCalledOnce();
    expect(removeTempEntry).toHaveBeenCalledWith('emdash-tui-prompt-stale');
  });
});
