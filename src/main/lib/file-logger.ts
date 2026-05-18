import { appendFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import {
  serializeLogValue,
  stringifyLogValue,
  type Level,
  type LogSinkEntry,
} from '@shared/logger';
import { APP_SCHEME } from '@main/app/protocol';

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const DIAGNOSTIC_LOG_BYTES = 500 * 1024;
const RETAINED_LOG_FILES = 5;
const LOG_FILE_NAME = 'emdash.log';
const DIAGNOSTIC_ATTACHMENT_FILENAME = 'emdash-diagnostics.log';
const RENDERER_LOG_PAYLOAD_LIMIT = 64 * 1024;
const PROCESS_EXIT_FLUSH_TIMEOUT_MS = 1000;

const SECRET_KEY_NAMES =
  'authorization|api[_-]?key|token|password|passphrase|secret|access[_-]?token|refresh[_-]?token|client[_-]?secret';

type RedactionReplacement = string | ((substring: string, ...args: string[]) => string);

const SECRET_PATTERNS: Array<[RegExp, RedactionReplacement]> = [
  // JSON-quoted key/value: handles both "key":"value" and escaped \"key\":\"value\"
  [
    new RegExp(`(\\\\?")(${SECRET_KEY_NAMES})(\\\\?")(\\s*:\\s*)\\\\?"[^"\\\\]*\\\\?"`, 'gi'),
    (_match, openQuote: string, keyName: string, closeQuote: string, separator: string) =>
      `${openQuote}${keyName}${closeQuote}${separator}${openQuote}[REDACTED]${openQuote}`,
  ],
  // Unquoted: key=value or key: bearer value
  [
    new RegExp(`\\b(${SECRET_KEY_NAMES})(\\s*[:=]\\s*)(?:bearer\\s+)?[^\\s,"'}]+`, 'gi'),
    '$1$2[REDACTED]',
  ],
  // PEM blocks (private keys)
  [/-----BEGIN[^-\n]{1,40}-----[\s\S]+?-----END[^-\n]{1,40}-----/g, '[REDACTED_PEM_BLOCK]'],
  // Known token prefixes — order matters: vendor-specific before generic
  [/\bgh[opsu]_[A-Za-z0-9]{36,255}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bglpat-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_GITLAB_TOKEN]'],
  [/\bnpm_[A-Za-z0-9]{36,}\b/g, '[REDACTED_NPM_TOKEN]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g, '[REDACTED_STRIPE_KEY]'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_ANTHROPIC_KEY]'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_OPENAI_KEY]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, '[REDACTED_SLACK_TOKEN]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]'],
];

const PII_PATTERNS: Array<[RegExp, RedactionReplacement]> = [
  // Any scheme://user:pass@ — covers postgres, mongodb, redis, mysql, amqp, https…
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/?#@]+:[^\s@/?#]+@/gi, '$1[REDACTED_CREDENTIALS]@'],
  [/\b(git|hg|svn)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '$1@[REDACTED_HOST]'],
  [/\b(?:[A-F0-9]{2}:){5}[A-F0-9]{2}\b/gi, '[REDACTED_MAC]'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED_IP]'],
  [/\b(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{1,4}\b/gi, '[REDACTED_IP]'],
  [/\/Users\/[^\s/]+/gi, '/Users/[REDACTED_USER]'],
  [/\/home\/[^\s/]+/g, '/home/[REDACTED_USER]'],
  [/[A-Z]:\\Users\\[^\s\\]+/gi, (match) => `${match.slice(0, 9)}[REDACTED_USER]`],
];

let logFilePath: string | undefined;
let logDirReady = false;
let pendingWrite: Promise<void> = Promise.resolve();

export function initializeFileLogger() {
  const electronApp = app as Electron.App | undefined;
  if (!electronApp?.setAppLogsPath) return;

  electronApp.setAppLogsPath(join(electronApp.getPath('userData'), 'logs'));
  logFilePath = join(electronApp.getPath('logs'), LOG_FILE_NAME);
}

export function getLogFilePath() {
  return logFilePath;
}

export async function getDiagnosticLogAttachment() {
  if (!logFilePath) initializeFileLogger();
  const path = logFilePath;

  const fallback = {
    filename: DIAGNOSTIC_ATTACHMENT_FILENAME,
    mimeType: 'text/plain' as const,
    content: 'No application logs were available.',
  };

  if (!path) return fallback;

  const raw = await readFile(path, 'utf8').catch(() => '');
  const tail = trimToLineBoundary(raw, DIAGNOSTIC_LOG_BYTES);
  const redacted = redactDiagnosticLog(tail);

  return {
    filename: DIAGNOSTIC_ATTACHMENT_FILENAME,
    mimeType: 'text/plain' as const,
    content: redacted || fallback.content,
  };
}

export function writeLogEntry(entry: LogSinkEntry) {
  if (!logFilePath) initializeFileLogger();
  const path = logFilePath;
  if (!path) return;

  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level: entry.level,
    source: entry.source ?? 'main',
    message: formatMessage(entry.input),
    data: entry.input.map(serializeLogValue),
  });
  const line = `${redactDiagnosticLog(payload)}\n`;

  pendingWrite = pendingWrite
    .then(async () => {
      if (!logDirReady) {
        await mkdir(join(path, '..'), { recursive: true });
        logDirReady = true;
      }
      await rotateIfNeeded(path, Buffer.byteLength(line));
      await appendFile(path, line, 'utf8');
    })
    .catch((error) => {
      console.error('Failed to write application log:', error);
    });
}

export function flushLogWrites() {
  return pendingWrite;
}

export function registerProcessErrorLogging(log: {
  error: (message: string, details?: unknown) => void;
}) {
  process.on('uncaughtException', (error) => {
    log.error('Uncaught exception', serializeLogValue(error));
    flushAndExit();
  });

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection', serializeLogValue(reason));
    flushAndExit();
  });
}

function flushAndExit() {
  const flush = Promise.race([
    flushLogWrites(),
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
    writeLogEntry(parsed);
  });
}

function isTrustedRendererSender(frame: Electron.WebFrameMain | null): boolean {
  if (!frame) return false;
  try {
    const url = frame.url;
    if (!url) return false;
    if (url.startsWith(`${APP_SCHEME}://`)) return true;
    // Allow dev server during local development only
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

async function rotateIfNeeded(path: string, incomingBytes: number) {
  const current = await stat(path).catch(() => undefined);
  if (!current || current.size + incomingBytes <= MAX_LOG_BYTES) return;

  await unlink(`${path}.${RETAINED_LOG_FILES}`).catch(() => undefined);

  for (let index = RETAINED_LOG_FILES - 1; index >= 1; index -= 1) {
    await rename(`${path}.${index}`, `${path}.${index + 1}`).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Log rotation rename failed:', error);
      }
    });
  }

  await rename(path, `${path}.1`).catch((error) => {
    console.error('Log rotation rename failed:', error);
  });
}

function trimToLineBoundary(value: string, maxBytes: number) {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.byteLength <= maxBytes) return value;
  const sliced = encoded.slice(-maxBytes).toString('utf8');
  const newline = sliced.indexOf('\n');
  if (newline === -1 || newline === sliced.length - 1) return sliced;
  return sliced.slice(newline + 1);
}

function parseRendererLog(payload: unknown): LogSinkEntry | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  if (!isLevel(record.level)) return undefined;
  const input = Array.isArray(record.input) ? record.input : [record.input];
  return { level: record.level, source: 'renderer', input };
}

function isLevel(value: unknown): value is Level {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

function formatMessage(input: unknown[]) {
  return input
    .map((value) => {
      if (typeof value === 'string') return value;
      if (value instanceof Error) return value.message;
      return stringifyLogValue(value);
    })
    .join(' ');
}

export function redactDiagnosticLog(value: string) {
  return redactPii(redactSecrets(value));
}

function redactSecrets(value: string) {
  return applyRedactions(value, SECRET_PATTERNS);
}

function redactPii(value: string) {
  return applyRedactions(value, PII_PATTERNS);
}

function applyRedactions(value: string, patterns: Array<[RegExp, RedactionReplacement]>) {
  return patterns.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement as string),
    value
  );
}
