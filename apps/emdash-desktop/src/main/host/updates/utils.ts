import { redactAll } from '@emdash/shared/logger';

function stripMarkup(raw: string): string {
  if (!raw) return 'Unknown update error';

  const withoutData = raw.includes('Data:') ? raw.slice(0, raw.indexOf('Data:')) : raw;
  const noHtml = withoutData.replace(/<!DOCTYPE html.*$/is, '').replace(/<html.*$/is, '');
  const collapsed = noHtml.replace(/\s+/g, ' ').trim();
  if (!collapsed) return 'Unknown update error';
  return redactAll(collapsed);
}

export function getUpdaterErrorDetails(error: unknown): string {
  const err = error as Error & {
    statusCode?: number;
    code?: string;
    status?: number;
    statusMessage?: string;
    description?: string;
  };
  const status = err?.statusCode || err?.code || err?.status;
  const statusText = err?.statusMessage || err?.description;
  const message = stripMarkup(
    error instanceof Error ? error.message : String(error ?? 'Unknown update error')
  );
  if (status) {
    const base = `Update request failed with HTTP ${status}`;
    const summary = statusText ? `${base}: ${stripMarkup(String(statusText))}` : base;
    return error instanceof Error && message !== summary ? `${summary}\n${message}` : summary;
  }
  return message;
}

export function formatUpdaterError(error: unknown): string {
  const summary = getUpdaterErrorDetails(error).split('\n')[0];
  return summary.length > 240 ? `${summary.slice(0, 240)}…` : summary;
}

export function sanitizeUpdaterLogArgs(args: unknown[]) {
  return args.map((arg) => {
    if (arg instanceof Error) return formatUpdaterError(arg);
    if (typeof arg === 'string') return formatUpdaterError(arg);
    return arg;
  });
}
