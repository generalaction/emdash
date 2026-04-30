import { useFeatureFlagEnabled } from 'posthog-js/react';

/**
 * Returns true when the named PostHog feature flag is enabled for this client.
 * Returns false while flags are loading or when PostHog is not configured.
 *
 * In dev builds, VITE_FLAG_<name> env vars take precedence (hyphens → underscores).
 * Example: VITE_FLAG_workspace_provider=true in .env.local enables "workspace-provider".
 */
export function useFeatureFlag(flag: string): boolean {
  const posthogValue = useFeatureFlagEnabled(flag) ?? false;

  if (import.meta.env.DEV) {
    const envKey = `VITE_FLAG_${flag.replace(/-/g, '_')}`;
    const override = import.meta.env[envKey];
    if (override !== undefined) {
      return override === 'true' || override === '1';
    }
  }

  return posthogValue;
}
