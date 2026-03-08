/**
 * Simple telemetry client for renderer process.
 * Captures events and sends them to the main process via IPC.
 */
import { rpc } from './ipc';

export function captureTelemetry(event: string, properties?: Record<string, any>): void {
  try {
    void rpc.telemetry.capture({ event, properties });
  } catch {
    // Telemetry failures never break the app
  }
}
