/**
 * Matches common shell prompt endings: $, #, %, >, ❯ preceded by a non-digit, non-space character.
 * Each chunk is matched independently — prompts split across TCP segments rely on the timeout fallback.
 */
const SHELL_PROMPT_RE = /\S.*(?<!\d)[#$%>❯]\s*$/;

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, '');
}

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

  const unsubscribe = subscribe((chunk: string) => {
    if (done) return;
    const clean = stripAnsi(chunk);
    if (SHELL_PROMPT_RE.test(clean)) {
      finish();
    }
  });

  const timer = setTimeout(() => {
    onTimeout?.();
    finish();
  }, timeoutMs);

  return { cancel };
}
