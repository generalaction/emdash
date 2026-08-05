import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { redactAll, serializeLogValue, stringifyLogValue } from '@emdash/shared/logger';
import { createFileTransport, trimToLineBoundary } from '@emdash/shared/logger/transport';
import { app } from 'electron';
import type pinoLib from 'pino';
import { APP_SCHEME } from '@main/app/protocol';

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const DIAGNOSTIC_LOG_BYTES = 500 * 1024;
const RETAINED_LOG_FILES = 5;
const LOG_FILE_NAME = 'emdash.log';
const DIAGNOSTIC_ATTACHMENT_FILENAME = 'emdash-diagnostics.log';
const RENDERER_LOG_PAYLOAD_LIMIT = 64 * 1024;
const PROCESS_EXIT_FLUSH_TIMEOUT_MS = 2_500;

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
let logFilePath: string | undefined;

export function initializeFileLogger() {
  const override = process.env.EMDASH_LOG_FILE?.trim();
  if (override) {
    logFilePath = resolve(override);
    return;
  }

  const electronApp = app as Electron.App | undefined;
  if (!electronApp?.setAppLogsPath) return;

  electronApp.setAppLogsPath(join(electronApp.getPath('userData'), 'logs'));
  logFilePath = join(electronApp.getPath('logs'), LOG_FILE_NAME);
}

export function getLogFilePath(): string | undefined {
  return logFilePath;
}

function resolveLogPath(): string | undefined {
  if (!logFilePath) initializeFileLogger();
  return logFilePath;
}

/**
 * Singleton file transport — shared between the pino destination and the
 * renderer log intake so there is exactly one serialized write queue.
 */
const sharedTransport = createFileTransport({
  path: resolveLogPath,
  maxBytes: MAX_LOG_BYTES,
  retainedFiles: RETAINED_LOG_FILES,
  redact: redactAll,
});

/**
 * Returns a pino-compatible DestinationStream backed by the shared transport.
 * Called once at main-process logger construction.
 */
export function getLogFileDestination(): pinoLib.DestinationStream {
  return sharedTransport.asDestination();
}

export function flushLogWrites(): Promise<void> {
  return sharedTransport.flush();
}

export async function getDiagnosticLogAttachment() {
  const path = resolveLogPath();

  const fallback = {
    filename: DIAGNOSTIC_ATTACHMENT_FILENAME,
    mimeType: 'text/plain' as const,
    content: 'No application logs were available.',
  };

  if (!path) return fallback;

  const raw = await readFile(path, 'utf8').catch(() => '');
  const tail = trimToLineBoundary(raw, DIAGNOSTIC_LOG_BYTES);
  const redacted = redactAll(tail);

  return {
    filename: DIAGNOSTIC_ATTACHMENT_FILENAME,
    mimeType: 'text/plain' as const,
    content: redacted || fallback.content,
  };
}

type FatalErrorReporter = (
  error: unknown,
  mechanism: 'uncaught_exception' | 'unhandled_rejection'
) => void | Promise<void>;

export function registerProcessErrorLogging(
  logger: { error(...input: unknown[]): void },
  reportFatalError?: FatalErrorReporter
) {
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    handleFatalError(error, 'uncaught_exception', reportFatalError);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', reason);
    handleFatalError(reason, 'unhandled_rejection', reportFatalError);
  });
}

let fatalExitStarted = false;

function handleFatalError(
  error: unknown,
  mechanism: 'uncaught_exception' | 'unhandled_rejection',
  reportFatalError?: FatalErrorReporter
) {
  if (fatalExitStarted) return;
  fatalExitStarted = true;
  let reportPromise: void | Promise<void>;
  try {
    reportPromise = reportFatalError?.(error, mechanism);
  } catch {
    reportPromise = undefined;
  }
  const flush = Promise.race([
    Promise.allSettled([flushLogWrites(), Promise.resolve(reportPromise)]),
    new Promise<void>((resolve) => setTimeout(resolve, PROCESS_EXIT_FLUSH_TIMEOUT_MS)),
  ]);
  void flush.finally(() => process.exit(1));
}

export function registerRendererLogHandler(ipcMain: Electron.IpcMain) {
  ipcMain.on('emdash:renderer-log', (event, payload: unknown) => {
    if (!isTrustedRendererSender(event.senderFrame)) return;
    if (!isWithinPayloadLimit(payload)) return;
    const parsed = parseRendererLog(payload);
    if (!parsed) return;
    writeRendererLogEntry(parsed);
  });
}

function writeRendererLogEntry(entry: { level: LogLevel; source: string; input: unknown[] }) {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level: entry.level,
    source: entry.source,
    message: entry.input.map((v) => (typeof v === 'string' ? v : stringifyLogValue(v))).join(' '),
    data: entry.input.map(serializeLogValue),
  });

  sharedTransport.write(payload);
}

function isTrustedRendererSender(frame: Electron.WebFrameMain | null): boolean {
  if (!frame) return false;
  try {
    const url = frame.url;
    if (!url) return false;
    if (url.startsWith(`${APP_SCHEME}://`)) return true;
    if (process.env.NODE_ENV !== 'production' && url.startsWith('http://localhost:')) return true;
    return false;
  } catch {
    return false;
  }
}

function isWithinPayloadLimit(payload: unknown): boolean {
  try {
    return JSON.stringify(payload).length <= RENDERER_LOG_PAYLOAD_LIMIT;
  } catch {
    return false;
  }
}

function parseRendererLog(
  payload: unknown
): { level: LogLevel; source: string; input: unknown[] } | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  if (!isLevel(record.level)) return undefined;
  const input = Array.isArray(record.input) ? record.input : [record.input];
  return { level: record.level, source: 'renderer', input };
}

function isLevel(value: unknown): value is LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

/** Exported for diagnostic attachment (used in the diagnostics controller). */
export function redactDiagnosticLog(value: string): string {
  return redactAll(value);
}
