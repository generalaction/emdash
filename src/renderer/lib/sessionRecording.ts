// Lightweight PostHog session recording manager, opt-in only.
// Uses dynamic import to avoid adding posthog-js to the main bundle when disabled.

type PosthogClient = typeof import('posthog-js');

let client: PosthogClient['default'] | null = null;
let active = false;

export type SessionRecordingConfig = {
  apiKey: string;
  host: string;
  distinctId?: string;
  seed?: number;
};

const baseConfig = {
  autocapture: false,
  capture_pageview: false,
  capture_pageleave: false,
  disable_session_recording: true, // we start manually after init
  persistence: 'memory' as const, // keep data in-memory only
  session_recording: {
    maskAllInputs: true,
    maskAllText: true,
    maskAllImages: true,
    blockClass: 'emdash-sensitive',
  },
};

export async function enableSessionRecording(config: SessionRecordingConfig): Promise<void> {
  if (typeof window === 'undefined') return;
  if (active) return;
  const { default: posthog } = await import('posthog-js');

  posthog.init(config.apiKey, {
    ...baseConfig,
    api_host: config.host,
  });
  if (config.distinctId) {
    posthog.identify(config.distinctId);
  }
  posthog.startSessionRecording();

  client = posthog;
  active = true;
}

export function disableSessionRecording(): void {
  if (!client) return;
  try {
    client.stopSessionRecording();
    // posthog-js exposes shutdown on the default instance
    (client as any).shutdown?.();
  } catch {
    // ignore
  } finally {
    client = null;
    active = false;
  }
}

export function isSessionRecordingActive(): boolean {
  return active;
}

export async function syncSessionRecordingFromMain(): Promise<void> {
  if (typeof window === 'undefined' || !(window as any).electronAPI?.getTelemetryClientConfig) {
    return;
  }
  try {
    const res = await (window as any).electronAPI.getTelemetryClientConfig();
    const cfg = res?.config;
    if (
      res?.success &&
      cfg?.enabled &&
      cfg.sessionRecordingOptIn &&
      cfg.host &&
      cfg.apiKey
    ) {
      await enableSessionRecording({
        apiKey: cfg.apiKey,
        host: cfg.host,
        distinctId: cfg.distinctId,
      });
      return;
    }
  } catch {
    // ignore
  }
  disableSessionRecording();
}
