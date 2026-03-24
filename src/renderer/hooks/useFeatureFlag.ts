import { useFeatureFlagEnabled } from 'posthog-js/react';

/**
 * Returns `true` only when the named PostHog feature flag is explicitly enabled.
 * While loading, uninitialized, or when the flag is off, returns `false`.
 */
export function useFeatureFlag(flag: string): boolean {
  return useFeatureFlagEnabled(flag) === true;
}
