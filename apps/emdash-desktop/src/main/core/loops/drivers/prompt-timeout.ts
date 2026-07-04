import { err, type Result } from '@main/lib/result';
import type { LoopSessionDriver, LoopSessionDriverError, PromptResult } from './session-driver';

function isMeaningfulMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized !== '' && normalized !== 'undefined' && normalized !== 'null';
}

export function safeMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && isMeaningfulMessage(value)) return value;
  if (value instanceof Error && isMeaningfulMessage(value.message)) return value.message;
  if (value && typeof value === 'object' && 'message' in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string' && isMeaningfulMessage(message)) return message;
  }
  return fallback;
}

export function resolvePromptTimeoutMs(defaultTimeoutMs: number): number {
  const raw = process.env.EMDASH_LOOP_PROMPT_TIMEOUT_MS;
  if (!raw) return defaultTimeoutMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultTimeoutMs;
}

export async function sendPromptWithTimeout(input: {
  driver: LoopSessionDriver;
  conversationId: string;
  prompt: string;
  timeoutMs: number;
  failureMessage: string;
  timeoutLabel: string;
}): Promise<Result<PromptResult, LoopSessionDriverError>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const promptPromise = input.driver
    .sendPrompt(input.conversationId, input.prompt)
    .catch((error): Result<PromptResult, LoopSessionDriverError> => {
      return err({
        kind: 'prompt-failed',
        message: safeMessage(error, input.failureMessage),
      });
    });

  const timeoutPromise = new Promise<Result<PromptResult, LoopSessionDriverError>>((resolve) => {
    timeout = setTimeout(() => {
      void input.driver.cancelPrompt(input.conversationId).catch(() => {});
      resolve(
        err({
          kind: 'prompt-failed',
          message: `${input.timeoutLabel} timed out after ${Math.ceil(input.timeoutMs / 1000)}s.`,
        })
      );
    }, input.timeoutMs);
  });

  const result = await Promise.race([promptPromise, timeoutPromise]);
  if (timeout) clearTimeout(timeout);
  return result;
}
