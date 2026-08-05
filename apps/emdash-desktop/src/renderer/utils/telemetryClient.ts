/**
 * Simple telemetry client for renderer process.
 * Captures events and sends them to the main process via IPC.
 */
import type {
  TelemetryEvent,
  TelemetryExceptionReport,
  TelemetryProperties,
} from '@shared/telemetry';
import { rpc } from '../lib/ipc';
import { focusTracker } from './focus-tracker';
import { getTelemetryScope } from './telemetry-scope';

let cachedSessionId: string | null | undefined;
let pendingSessionIdPromise: Promise<string | null> | null = null;

async function getSessionId(): Promise<string | null> {
  if (cachedSessionId !== undefined) return cachedSessionId;
  if (pendingSessionIdPromise) return pendingSessionIdPromise;

  pendingSessionIdPromise = rpc.telemetry
    .getStatus()
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

  void rpc.telemetry
    .capture({
      event,
      properties: {
        ...(properties ?? {}),
        ...getTelemetryScope(),
        ...(sessionId ? { session_id: sessionId } : {}),
      },
    })
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

export function captureException(
  error: unknown,
  mechanism: TelemetryExceptionReport['mechanism'],
  componentStack?: string
): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  void rpc.telemetry
    .captureException({
      name: normalized.name || 'Error',
      message: normalized.message || 'Unknown error',
      stack: normalized.stack,
      componentStack,
      mechanism,
    })
    .catch(() => {
      // Error reporting must never break the renderer.
    });
}

focusTracker.setTransitionEmitter((properties) => {
  captureTelemetry('focus_changed', properties);
});
