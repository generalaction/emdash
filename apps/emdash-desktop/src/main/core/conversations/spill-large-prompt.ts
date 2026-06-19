import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { log } from '@main/lib/logger';

/**
 * Maximum initial-prompt length (in characters) we pass directly on the command
 * line. Beyond this we spill the prompt to a temporary markdown file and hand the
 * agent a short pointer message instead.
 *
 * Large prompts (e.g. a Linear issue description plus its full comment/activity
 * context) can blow past OS argument limits and crash the underlying CLI — see
 * ENG-1546, where Kilo Code interpreted the prompt as a path and threw
 * ENAMETOOLONG. Spilling to a file keeps the invocation small regardless of the
 * agent, and the agent simply reads the file to recover the full context.
 */
export const MAX_INLINE_PROMPT_CHARS = 16_384;

const TEMP_DIR_PREFIX = 'emdash-prompt-';
const CONTEXT_FILE_NAME = 'task-context.md';

/** Build the short pointer message handed to the agent in place of a huge prompt. */
export function buildPromptPointerMessage(filePath: string): string {
  return (
    `The full task context was too large to pass on the command line, so it has ` +
    `been written to a file. Read the file at ${filePath} and complete the task ` +
    `described in it.`
  );
}

export type SpillLargePromptDeps = {
  maxChars?: number;
  createTempDir?: () => Promise<string>;
  writeContextFile?: (filePath: string, contents: string) => Promise<void>;
  onError?: (error: unknown, promptLength: number) => void;
};

const defaultDeps: Required<SpillLargePromptDeps> = {
  maxChars: MAX_INLINE_PROMPT_CHARS,
  createTempDir: () => mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX)),
  writeContextFile: (filePath, contents) => writeFile(filePath, contents, 'utf8'),
  onError: (error, promptLength) =>
    log.warn('Failed to spill large prompt to file; passing it inline instead', {
      error: String(error),
      promptLength,
    }),
};

/**
 * If `prompt` is larger than the configured threshold, write it to a temporary
 * markdown file and return a short pointer message instructing the agent to read
 * that file. Otherwise (or if writing fails) return the prompt unchanged.
 */
export async function spillLargePrompt(
  prompt: string,
  deps: SpillLargePromptDeps = {}
): Promise<string> {
  const { maxChars, createTempDir, writeContextFile, onError } = { ...defaultDeps, ...deps };

  if (prompt.length <= maxChars) return prompt;

  try {
    const dir = await createTempDir();
    const filePath = join(dir, CONTEXT_FILE_NAME);
    await writeContextFile(filePath, prompt);
    return buildPromptPointerMessage(filePath);
  } catch (error) {
    onError(error, prompt.length);
    return prompt;
  }
}
