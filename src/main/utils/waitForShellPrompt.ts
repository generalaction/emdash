import { stripForPromptDetection } from '@shared/text/stripAnsi';

/**
 * Matches common shell prompt endings: $, #, %, >, ❯ preceded by a non-digit, non-space character.
 * Chunks are accumulated so prompts split across TCP segments are still detected.
 */
const SHELL_PROMPT_RE = /\S.*(?<!\d)[#$%>❯]\s*$/;

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

  let buffer = '';
  // Use `let` so unsubscribe is available if subscribe's callback fires
  // synchronously (e.g. earlyChunks replay) before subscribe() returns.
  let unsubscribe: () => void = () => {};
  unsubscribe = subscribe((chunk: string) => {
    if (done) return;
    buffer += chunk;
    // Keep only the tail to bound memory on large MOTD output.
    // The regex uses $ (end-of-string) so only the tail matters.
    if (buffer.length > 2048) {
      buffer = buffer.slice(-1024);
    }
    if (SHELL_PROMPT_RE.test(stripForPromptDetection(buffer))) {
      finish();
    }
  });

  const timer = setTimeout(() => {
    onTimeout?.();
    finish();
  }, timeoutMs);

  return { cancel };
}
