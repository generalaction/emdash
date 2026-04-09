/**
 * Simple telemetry client for renderer process.
 * Captures events and sends them to the main process via IPC.
 */
import type { TelemetryEvent, TelemetryEventProperties } from '@shared/telemetry';
import { rpc } from '../core/ipc';
import { focusTracker } from './focus-tracker';

function captureWithProps(event: TelemetryEvent, properties?: Record<string, unknown>): void {
  void rpc.telemetry.capture({ event, properties }).catch(() => {
    // Telemetry failures never break the app
  });
}

export function captureTelemetry<E extends TelemetryEvent>(
  event: E,
  properties?: TelemetryEventProperties[E]
): void {
  captureWithProps(event, {
    ...focusTracker.getContext(),
    ...(properties as Record<string, unknown> | undefined),
  });
}

focusTracker.setTransitionEmitter((properties) => {
  captureTelemetry('focus_changed', properties);
});
