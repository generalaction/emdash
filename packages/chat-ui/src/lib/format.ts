/**
 * Formatting utilities — pure functions for human-readable strings.
 */

/** Convert a duration in milliseconds to a whole-seconds string, e.g. 3200 → "3". */
export function formatDurationSeconds(ms: number): string {
  return String(Math.floor(ms / 1000));
}
