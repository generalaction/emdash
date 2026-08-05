/**
 * Logging for the process deaths that never reach an exception handler.
 *
 * A renderer, GPU, or utility process that dies takes no main-process code
 * path with it: the window white-screens, or a feature quietly stops working,
 * and `uncaughtException` never fires. The session log just ends. That leaves
 * an OS-killed renderer — the shape a memory incident takes — reconstructible
 * only from a platform crash report, if one was kept at all.
 *
 * These handlers put the cause in emdash's own log, where the rest of the
 * session already is. Electron reports `clean-exit` for every normally
 * terminated helper at shutdown, so that reason is dropped rather than
 * recorded as a crash.
 */

/** Common shape of both `*-process-gone` detail payloads. */
export interface ProcessGoneDetails {
  reason: string;
  exitCode: number;
}

export interface ChildProcessGoneDetails extends ProcessGoneDetails {
  type: string;
  name?: string;
  serviceName?: string;
}

/** A structured log line: message plus the fields worth keeping. */
export interface ProcessGoneReport {
  message: string;
  fields: Record<string, unknown>;
}

/** Ordinary teardown, reported by every helper process at shutdown. */
const CLEAN_EXIT = 'clean-exit';

/**
 * The renderer report, or null when the exit was ordinary teardown. The URL
 * distinguishes the app window from a browser-pane webview, whose crash says
 * nothing about emdash itself.
 */
export function reportRenderProcessGone(
  details: ProcessGoneDetails,
  url: string | undefined
): ProcessGoneReport | null {
  if (details.reason === CLEAN_EXIT) return null;
  return {
    message: 'Renderer process gone',
    fields: { reason: details.reason, exitCode: details.exitCode, url },
  };
}

/** The child-process report, or null when the exit was ordinary teardown. */
export function reportChildProcessGone(details: ChildProcessGoneDetails): ProcessGoneReport | null {
  if (details.reason === CLEAN_EXIT) return null;
  return {
    message: 'Child process gone',
    fields: {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      name: details.name,
      serviceName: details.serviceName,
    },
  };
}

/** Reading the URL of a WebContents that is already tearing down throws. */
function urlOf(contents: { getURL(): string }): string | undefined {
  try {
    return contents.getURL();
  } catch {
    return undefined;
  }
}

/** The `Electron.App` surface these handlers need, narrowed so tests can stub it. */
export interface ProcessCrashEventSource {
  on(
    event: 'render-process-gone',
    listener: (event: unknown, contents: { getURL(): string }, details: ProcessGoneDetails) => void
  ): unknown;
  on(
    event: 'child-process-gone',
    listener: (event: unknown, details: ChildProcessGoneDetails) => void
  ): unknown;
}

export interface CrashLogger {
  error(message: string, data?: unknown): void;
}

export function registerProcessCrashLogging(
  source: ProcessCrashEventSource,
  logger: CrashLogger
): void {
  source.on('render-process-gone', (_event, contents, details) => {
    const report = reportRenderProcessGone(details, urlOf(contents));
    if (report) logger.error(report.message, report.fields);
  });

  source.on('child-process-gone', (_event, details) => {
    const report = reportChildProcessGone(details);
    if (report) logger.error(report.message, report.fields);
  });
}
