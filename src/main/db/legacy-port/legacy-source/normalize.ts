import fs from 'node:fs';
import path from 'node:path';

function stripTrailingSlashes(input: string): string {
  if (input === '/') return input;
  return input.replace(/[\\/]+$/, '');
}

export function normalizeLocalPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) return '';

  let resolved = trimmed;
  try {
    resolved = fs.realpathSync.native(trimmed);
  } catch {
    resolved = path.resolve(trimmed);
  }

  resolved = stripTrailingSlashes(resolved);
  if (!resolved) return path.sep;

  if (process.platform === 'darwin' || process.platform === 'win32') {
    return resolved.toLowerCase();
  }

  return resolved;
}

export function normalizeRemotePath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) return '';

  const normalized = path.posix.normalize(trimmed);
  if (normalized === '/') return normalized;
  return normalized.replace(/\/+$/, '');
}

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function normalizePort(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 22;
}

export function makeSshFingerprint(host: string, port: number, username: string): string {
  return `${normalizeHost(host)}:${port}:${normalizeUsername(username)}`;
}
