import type { FileError } from '@emdash/core/files';

const PERMISSION_DENIED = 'PERMISSION_DENIED';

export function fileErrorToMessage(error: FileError): string {
  return error.message;
}

export function isPermissionDenied(error: FileError): boolean {
  if (error.type !== 'fs-error') return false;
  return (
    error.code === PERMISSION_DENIED ||
    error.code === 'EACCES' ||
    error.code === 'EPERM' ||
    error.message.toLowerCase().includes('permission denied')
  );
}
