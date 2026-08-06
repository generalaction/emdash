import type { DevPerfTraceError } from '../contract';
import { getDevPerfClient } from './client';

/** One knob for every trace-capture entry point (process panel button, palette command). */
export const TRACE_CAPTURE_DURATION_MS = 10_000;

export type TraceCaptureOutcome =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly message: string };

function traceErrorMessage(error: DevPerfTraceError): string {
  switch (error.type) {
    case 'trace_in_progress':
      return 'A trace capture is already in progress';
  }
}

/**
 * Run one trace capture and normalize every failure mode — expected
 * (capture already running) and unexpected (transport errors) — into a
 * user-presentable message.
 */
export async function captureDevPerfTrace(): Promise<TraceCaptureOutcome> {
  try {
    const client = await getDevPerfClient();
    const result = await client.captureTrace({ durationMs: TRACE_CAPTURE_DURATION_MS });
    if (!result.success) return { ok: false, message: traceErrorMessage(result.error) };
    return { ok: true, path: result.data.path };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
