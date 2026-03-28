import { stripAnsi } from '@shared/text/stripAnsi';

/**
 * Matches common shell prompt endings: $, #, %, >, ❯ preceded by a non-digit, non-space character.
 * Tests against a rolling sanitized buffer so prompts split across PTY chunks still match.
 */
const SHELL_PROMPT_RE = /\S.*(?<!\d)[#$%>❯]\s*$/;
const PROMPT_END_CHARS = new Set(['#', '$', '%', '>', '❯']);
// Keep enough recent output to match delayed prompts without retaining unbounded PTY history.
const PROMPT_BUFFER_MAX = 1024;

export interface PromptWaitOptions {
  subscribe: (callback: (chunk: string) => void) => () => void;
  write: (data: string) => void;
  data: string;
  timeoutMs?: number;
  onTimeout?: () => void;
}

export interface PromptWaitHandle {
  cancel(): void;
}

/**
 * Waits for a shell prompt to appear in PTY output before writing data.
 * Falls back to writing after a configurable timeout.
 */
export function waitForShellPrompt(options: PromptWaitOptions): PromptWaitHandle {
  const { subscribe, write, data, timeoutMs = 15000, onTimeout } = options;
  const noop: PromptWaitHandle = { cancel: () => {} };
  if (!data) return noop;

  let done = false;
  let promptBuffer = '';

  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    unsubscribe();
    write(data);
  };

  const cancel = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    unsubscribe();
  };

  const unsubscribe = subscribe((chunk: string) => {
    if (done) return;

    const clean = stripAnsi(chunk, { includePrivateCsiParams: true });
    if (!clean) return;

    promptBuffer += clean;

    const lastLineBreak = Math.max(promptBuffer.lastIndexOf('\n'), promptBuffer.lastIndexOf('\r'));
    if (lastLineBreak >= 0) {
      promptBuffer = promptBuffer.slice(lastLineBreak + 1);
    }

    if (promptBuffer.length > PROMPT_BUFFER_MAX) {
      promptBuffer = promptBuffer.slice(-PROMPT_BUFFER_MAX);
    }

    let lastMeaningfulIndex = promptBuffer.length - 1;
    while (lastMeaningfulIndex >= 0 && /\s/.test(promptBuffer[lastMeaningfulIndex] ?? '')) {
      lastMeaningfulIndex -= 1;
    }
    if (lastMeaningfulIndex < 0) return;
    if (!PROMPT_END_CHARS.has(promptBuffer[lastMeaningfulIndex] ?? '')) {
      return;
    }

    if (SHELL_PROMPT_RE.test(promptBuffer)) {
      finish();
    }
  });

  const timer = setTimeout(() => {
    onTimeout?.();
    finish();
  }, timeoutMs);

  return { cancel };
}
