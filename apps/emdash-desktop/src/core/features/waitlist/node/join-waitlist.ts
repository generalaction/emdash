// Limits mirror the emdash.com waitlist API, which rejects requests outside them.
const NOTE_MAX_LENGTH = 1000;
const SOURCE_MAX_LENGTH = 64;
const SOURCE_DISALLOWED_CHARS = /[^\w .:/()-]/g;
// Control characters other than tab and newline; the API strips them anyway,
// and removing them here keeps the JSON body small.
// eslint-disable-next-line no-control-regex
const NOTE_DISALLOWED_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
// Longer than the API's worst case (two upstream calls), so a slow but
// successful signup isn't reported as a failure.
const DEFAULT_TIMEOUT_MS = 15_000;

/** Short messages shown to the user when a signup fails. */
export const WAITLIST_ERROR_MESSAGES = {
  invalidEmail: "That email address doesn't look right. Please check it and try again.",
  rateLimited: 'Too many attempts. Please try again in a minute.',
  unreachable: "We couldn't reach the waitlist server. Please try again.",
  rejected: "We couldn't add you to the waitlist. Please try again.",
} as const;

export type WaitlistSignupConfig = {
  /** Waitlist signup endpoint, e.g. https://emdash.com/api/waitlist. */
  apiUrl: string;
  /** Where the signup came from, e.g. "desktop app v1.2.10". */
  source: string;
  /** Request timeout in milliseconds. Defaults to 15 seconds. */
  timeoutMs?: number;
};

/** A failed signup: `message` is safe to show to the user, `detail` is for logs. */
export class WaitlistJoinError extends Error {
  constructor(
    message: string,
    readonly detail: string
  ) {
    super(message);
    this.name = 'WaitlistJoinError';
  }
}

/**
 * Sends a signup (and optional note) to the waitlist API in one request. The API
 * answers 200 for an email that is already on the list, so that counts as success.
 */
export async function joinWaitlist(
  config: WaitlistSignupConfig,
  args: { email: string; note: string }
): Promise<void> {
  const email = args.email.trim().toLowerCase();
  if (!email) throw new WaitlistJoinError(WAITLIST_ERROR_MESSAGES.invalidEmail, 'empty email');

  const note = truncate(args.note.replace(NOTE_DISALLOWED_CHARS, '').trim(), NOTE_MAX_LENGTH);
  const source = normalizeSource(config.source);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let response: Response;
  try {
    response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(note ? { email, note, source } : { email, source }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new WaitlistJoinError(
      WAITLIST_ERROR_MESSAGES.unreachable,
      describeFetchError(error, timeoutMs)
    );
  }

  const body = await readJsonObject(response);
  if (response.ok && body?.ok === true) return;

  const code = typeof body?.error === 'string' ? body.error : undefined;
  const retryAfter = response.headers.get('Retry-After');
  const detail = [
    `HTTP ${response.status}`,
    code,
    retryAfter ? `retry-after=${retryAfter}` : undefined,
  ]
    .filter(Boolean)
    .join(' ');
  throw new WaitlistJoinError(messageForFailure(response.status, code), detail);
}

function messageForFailure(status: number, code: string | undefined): string {
  if (code === 'invalid_email') return WAITLIST_ERROR_MESSAGES.invalidEmail;
  if (status === 429) return WAITLIST_ERROR_MESSAGES.rateLimited;
  if (status >= 500) return WAITLIST_ERROR_MESSAGES.unreachable;
  return WAITLIST_ERROR_MESSAGES.rejected;
}

function normalizeSource(source: string): string {
  const cleaned = source.replace(SOURCE_DISALLOWED_CHARS, '').slice(0, SOURCE_MAX_LENGTH).trim();
  return cleaned || 'desktop app';
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  // Don't cut an emoji or other astral character in half.
  const end = /[\uD800-\uDBFF]/.test(value[maxLength - 1] ?? '') ? maxLength - 1 : maxLength;
  return value.slice(0, end);
}

async function readJsonObject(response: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = await response.json();
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function describeFetchError(error: unknown, timeoutMs: number): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name === 'TimeoutError') return `timed out after ${timeoutMs}ms`;
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}
