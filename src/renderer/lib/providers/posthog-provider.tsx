import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { useEffect, type ReactNode } from 'react';
import { rpc } from '@renderer/lib/ipc';

const apiKey = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const apiHost = import.meta.env.VITE_POSTHOG_HOST as string | undefined;

if (apiKey && apiHost) {
  posthog.init(apiKey, {
    api_host: apiHost,
    capture_pageview: false,
    disable_session_recording: true,
    autocapture: false,
  });
}

function PostHogIdentitySync() {
  useEffect(() => {
    if (!apiKey || !apiHost) return;
    rpc.telemetry
      .getStatus()
      .then(({ status }) => {
        if (status?.instance_id) posthog.identify(status.instance_id);
      })
      .catch(() => {});
  }, []);
  return null;
}

export function PostHogFeatureFlagsProvider({ children }: { children: ReactNode }) {
  if (!apiKey || !apiHost) return <>{children}</>;
  return (
    <PostHogProvider client={posthog}>
      <PostHogIdentitySync />
      {children}
    </PostHogProvider>
  );
}
