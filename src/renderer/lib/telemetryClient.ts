/**
 * Simple telemetry client for renderer process.
 * Captures events and sends them to the main process via IPC.
 */

export function captureTelemetry(event: string, properties?: Record<string, any>): void {
  try {
    const api = (window as any).electronAPI;
    if (api?.captureTelemetry) {
      void api.captureTelemetry(event, properties);
    }
  } catch {
    // Telemetry failures never break the app
  }
}
