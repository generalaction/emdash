/** Returns true if terminal input looks like a real user task/prompt. */
export function isRealTaskLikeInput(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length < MIN_MESSAGE_LENGTH) return false;
  if (!HAS_ALPHA.test(trimmed)) return false;
  return !SKIP_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Strings that look like non-task-related input (confirmations, slash commands, etc.) */
const SKIP_PATTERNS = [
  /^\//,
  /^y(es)?$/i,
  /^n(o)?$/i,
  /^ok$/i,
  /^q(uit)?$/i,
  /^exit$/i,
  /^help$/i,
  /^\d+$/,
];

const HAS_ALPHA = /[A-Za-z]/;
const MIN_MESSAGE_LENGTH = 2;
