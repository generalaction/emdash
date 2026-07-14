import type { HostAbsolutePath } from '@primitives/path/api';
import type { FileSearchUnregisterRootError } from '@runtimes/file-search/api';

const EXPECTED_SQLITE_BASE_CODES = new Set([5, 6, 7, 8, 9, 10, 13, 14, 15]);
const EXPECTED_SQLITE_CODES = new Set([
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
  'SQLITE_NOMEM',
  'SQLITE_READONLY',
  'SQLITE_INTERRUPT',
  'SQLITE_IOERR',
  'SQLITE_FULL',
  'SQLITE_CANTOPEN',
  'SQLITE_PROTOCOL',
]);

export function expectedSqliteIoError(
  root: HostAbsolutePath,
  error: unknown,
  fallback: string
): FileSearchUnregisterRootError | undefined {
  if (!isExpectedSqliteError(error)) return undefined;
  return {
    type: 'io',
    root,
    message: error instanceof Error && error.message ? error.message : fallback,
  };
}

function isExpectedSqliteError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; errcode?: unknown };
  if (typeof candidate.code === 'string' && EXPECTED_SQLITE_CODES.has(candidate.code)) return true;
  if (typeof candidate.errcode !== 'number') return false;
  return EXPECTED_SQLITE_BASE_CODES.has(candidate.errcode & 0xff);
}
