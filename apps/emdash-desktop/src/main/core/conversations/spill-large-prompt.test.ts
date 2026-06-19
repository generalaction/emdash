import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  buildPromptPointerMessage,
  MAX_INLINE_PROMPT_CHARS,
  spillLargePrompt,
} from './spill-large-prompt';

describe('spillLargePrompt', () => {
  it('returns the prompt unchanged when below the threshold', async () => {
    const createTempDir = vi.fn();
    const writeContextFile = vi.fn();

    const result = await spillLargePrompt('short prompt', { createTempDir, writeContextFile });

    expect(result).toBe('short prompt');
    expect(createTempDir).not.toHaveBeenCalled();
    expect(writeContextFile).not.toHaveBeenCalled();
  });

  it('returns the prompt unchanged when exactly at the threshold', async () => {
    const writeContextFile = vi.fn();
    const prompt = 'x'.repeat(MAX_INLINE_PROMPT_CHARS);

    const result = await spillLargePrompt(prompt, {
      createTempDir: async () => '/tmp/emdash-prompt-xyz',
      writeContextFile,
    });

    expect(result).toBe(prompt);
    expect(writeContextFile).not.toHaveBeenCalled();
  });

  it('spills oversized prompts to a file and returns a pointer message', async () => {
    const prompt = 'y'.repeat(MAX_INLINE_PROMPT_CHARS + 1);
    let writtenPath = '';
    let writtenContents = '';

    const result = await spillLargePrompt(prompt, {
      createTempDir: async () => '/tmp/emdash-prompt-abc',
      writeContextFile: async (filePath, contents) => {
        writtenPath = filePath;
        writtenContents = contents;
      },
    });

    expect(writtenPath).toBe('/tmp/emdash-prompt-abc/task-context.md');
    expect(writtenContents).toBe(prompt);
    expect(result).toBe(buildPromptPointerMessage('/tmp/emdash-prompt-abc/task-context.md'));
    expect(result).toContain('/tmp/emdash-prompt-abc/task-context.md');
  });

  it('falls back to the inline prompt and reports when writing fails', async () => {
    const prompt = 'z'.repeat(MAX_INLINE_PROMPT_CHARS + 1);
    const onError = vi.fn();

    const result = await spillLargePrompt(prompt, {
      createTempDir: async () => '/tmp/emdash-prompt-fail',
      writeContextFile: async () => {
        throw new Error('disk full');
      },
      onError,
    });

    expect(result).toBe(prompt);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[1]).toBe(prompt.length);
  });

  it('writes a readable file on disk with the default dependencies', async () => {
    const prompt = `# Context\n${'paragraph '.repeat(2000)}`;

    const result = await spillLargePrompt(prompt);

    const match = result.match(/Read the file at (.+task-context\.md) and/);
    expect(match).not.toBeNull();
    const filePath = match![1];
    await expect(readFile(filePath, 'utf8')).resolves.toBe(prompt);
  });
});

describe('buildPromptPointerMessage', () => {
  it('references the file path and instructs the agent to read it', () => {
    const message = buildPromptPointerMessage('/tmp/ctx/task-context.md');
    expect(message).toContain('/tmp/ctx/task-context.md');
    expect(message.toLowerCase()).toContain('read the file');
  });
});
