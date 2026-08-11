/**
 * The boot splash gate: decides when the single boot loading state ends.
 *
 * The splash lifts when the last-active view can render — mementos and
 * navigation restored, the session/onboarding queries answered, and the one
 * project that view needs mounted — raced against a short timer. If the timer
 * wins, the workspace shows with that project in its existing "opening" state.
 */

export type SplashGateOutcome = 'ready' | 'timeout';

export const SPLASH_GATE_TIMEOUT_MS = 3000;

/**
 * Races the gate conditions against the splash deadline. A rejected condition
 * counts as settled: an errored dependency must surface its product error
 * state behind a lifted splash, never hold the splash forever.
 */
export function raceSplashGate(
  conditions: readonly Promise<unknown>[],
  timeoutMs: number
): Promise<SplashGateOutcome> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), timeoutMs);
    void Promise.allSettled(conditions).then(() => {
      clearTimeout(timer);
      resolve('ready');
    });
  });
}

let resolveAppQueries: (() => void) | undefined;
const appQueries = new Promise<void>((resolve) => {
  resolveAppQueries = resolve;
});

/** AppContent reports that the session/onboarding queries have resolved. */
export function reportAppQueriesSettled(): void {
  resolveAppQueries?.();
}

/** Gate condition: the session/onboarding queries have resolved. */
export function appQueriesSettled(): Promise<void> {
  return appQueries;
}
