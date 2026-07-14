import type { HostAbsolutePath } from '@primitives/path/api';
import type { FileSearchUnregisterRootError } from '@runtimes/file-search/api';

const EXPECTED_NODE_IO_CODES = new Set([
  'EAGAIN',
  'EBUSY',
  'EDQUOT',
  'EIO',
  'EMFILE',
  'ENFILE',
  'ENODEV',
  'ENOMEM',
  'ENOSPC',
  'ENXIO',
  'EROFS',
  'ESTALE',
  'ETIMEDOUT',
]);

export function nodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  return typeof (error as NodeJS.ErrnoException).code === 'string'
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

export function expectedNodeIoError(
  root: HostAbsolutePath,
  error: unknown,
  fallback: string
): FileSearchUnregisterRootError | undefined {
  const code = nodeErrorCode(error);
  if (!code || !EXPECTED_NODE_IO_CODES.has(code)) return undefined;
  return {
    type: 'io',
    root,
    message: errorMessage(error, fallback),
  };
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
