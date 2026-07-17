/**
 * Simple telemetry client for renderer process.
 * Captures events and sends them to the main process via IPC.
 */
import type { TelemetryEvent, TelemetryProperties } from '@core/primitives/telemetry/api/telemetry';
import { getDesktopWireClient } from '../lib/runtime/desktop-wire-client';
import { focusTracker } from './focus-tracker';
import { getTelemetryScope } from './telemetry-scope';

let cachedSessionId: string | null | undefined;
let pendingSessionIdPromise: Promise<string | null> | null = null;

async function getSessionId(): Promise<string | null> {
  if (cachedSessionId !== undefined) return cachedSessionId;
  if (pendingSessionIdPromise) return pendingSessionIdPromise;

  pendingSessionIdPromise = getDesktopWireClient()
    .then((client) => client.telemetry.getStatus())
    .then((result) => {
      cachedSessionId = result.status?.session_id ?? null;
      return cachedSessionId;
    })
    .catch(() => {
      return null;
    })
    .finally(() => {
      pendingSessionIdPromise = null;
    });

  return pendingSessionIdPromise;
}

async function captureWithProps(event: TelemetryEvent, properties?: Record<string, unknown>) {
  const sessionId = await getSessionId();

  void getDesktopWireClient()
    .then((client) =>
      client.telemetry.capture({
        event,
        properties: {
          ...(properties ?? {}),
          ...getTelemetryScope(),
          ...(sessionId ? { session_id: sessionId } : {}),
        },
      })
    )
    .catch(() => {});
}

export function captureTelemetry<E extends TelemetryEvent>(
  event: E,
  properties?: TelemetryProperties<E>
): void {
  void captureWithProps(event, {
    ...focusTracker.getContext(),
    ...(properties as Record<string, unknown> | undefined),
  }).catch(() => {
    // Telemetry failures never break the app
  });
}

focusTracker.setTransitionEmitter((properties) => {
  captureTelemetry('focus_changed', properties);
});
