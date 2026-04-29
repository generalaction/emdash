import { useFeatureFlagEnabled } from 'posthog-js/react';

/**
 * Returns true when the named PostHog feature flag is enabled for this client.
 * Returns false while flags are loading or when PostHog is not configured.
 */
export function useFeatureFlag(flag: string): boolean {
  return useFeatureFlagEnabled(flag) ?? false;
}
