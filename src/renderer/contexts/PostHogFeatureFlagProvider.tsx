import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { useTelemetryConsent } from '../hooks/useTelemetryConsent';
import { useEmdashAccount } from './EmdashAccountProvider';

export function PostHogFeatureFlagProvider({ children }: { children: ReactNode }) {
  const {
    prefEnabled: telemetryEnabled,
    loading: telemetryLoading,
    hasKeyAndHost,
  } = useTelemetryConsent();
  const { user, isSignedIn } = useEmdashAccount();
  const [initialized, setInitialized] = useState(false);

  // Initialize posthog-js once when telemetry is confirmed enabled.
  // Reads key/host from the main-process config (respects env var overrides).
  useEffect(() => {
    if (telemetryLoading || initialized) return;
    if (!telemetryEnabled || !hasKeyAndHost) return;

    void (async () => {
      try {
        const res = await window.electronAPI.getTelemetryStatus();
        const key = res?.status?.posthogKey;
        const host = res?.status?.posthogHost;
        if (!key || !host) return;

        posthog.init(key, {
          api_host: host,
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: false,
          disable_session_recording: true,
          persistence: 'localStorage',
        });
        setInitialized(true);
      } catch {
        // Telemetry must never crash the app
      }
    })();
  }, [telemetryEnabled, telemetryLoading, hasKeyAndHost, initialized]);

  // Identify / reset when account state changes
  useEffect(() => {
    if (!initialized) return;

    if (isSignedIn && user) {
      posthog.identify(user.username, { email: user.email });
    } else {
      posthog.reset();
    }
  }, [initialized, isSignedIn, user]);

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
