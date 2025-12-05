import { capture } from '../telemetry';

/**
 * Capture telemetry event with timing duration.
 * Automatically clamps duration to reasonable bounds and includes it in properties.
 */
export async function captureWithTiming<T>(
  event: string,
  operation: () => Promise<T> | T,
  additionalProps?: Record<string, any>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await operation();
    const duration = Date.now() - start;
    void capture(event as any, {
      ...additionalProps,
      duration_ms: duration,
    });
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    void capture(event as any, {
      ...additionalProps,
      duration_ms: duration,
    });
    throw error;
  }
}

