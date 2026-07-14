const OPERATIONAL_NODE_ERROR_CODES = new Set([
  'EAGAIN',
  'EACCES',
  'EBUSY',
  'ECANCELED',
  'EDQUOT',
  'EFBIG',
  'EINTR',
  'EINVAL',
  'EIO',
  'EISDIR',
  'ELOOP',
  'EMLINK',
  'EMFILE',
  'ENAMETOOLONG',
  'ENFILE',
  'ENODEV',
  'ENOENT',
  'ENOLCK',
  'ENOMEM',
  'ENOSYS',
  'ENOSPC',
  'ENOTDIR',
  'ENOTEMPTY',
  'ENOTSUP',
  'ENXIO',
  'EOPNOTSUPP',
  'EOVERFLOW',
  'EPERM',
  'EROFS',
  'ESTALE',
  'ETIMEDOUT',
  'ETXTBSY',
  'EXDEV',
]);

export function nodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  return typeof (error as NodeJS.ErrnoException).code === 'string'
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

export function isOperationalNodeError(error: unknown): boolean {
  const code = nodeErrorCode(error);
  return code !== undefined && OPERATIONAL_NODE_ERROR_CODES.has(code);
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
