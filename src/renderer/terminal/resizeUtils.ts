/**
 * Returns the debounce delay to use for the next PTY resize notification.
 * While within the post-attach stabilization window the delay is stretched to
 * the end of that window so all layout-settling fits collapse into one call.
 */
export function computeResizeDelay(
  attachStabilizeDeadline: number,
  nowMs: number,
  debounceMs: number
): number {
  const remaining = attachStabilizeDeadline - nowMs;
  return remaining > 0 ? remaining : debounceMs;
}
