export type FilesOnError = (context: string, error: unknown) => void;

export type FileError =
  | { type: 'invalid-path'; path: string; message: string }
  | { type: 'fs-error'; path: string; message: string; code?: string };

export const FILE_NOT_FOUND_ERROR_CODES = ['ENOENT', 'ENOTDIR', 'NOT_FOUND'] as const;

export type FileNotFoundErrorCode = (typeof FILE_NOT_FOUND_ERROR_CODES)[number];

export function classifyFileError(error: unknown, path: string): FileError {
  const code = (error as { code?: unknown } | undefined)?.code;
  return {
    type: 'fs-error',
    path,
    message: error instanceof Error ? error.message : String(error),
    ...(typeof code === 'string' ? { code } : {}),
  };
}

export function isFileNotFoundCode(code: unknown): code is FileNotFoundErrorCode {
  return (
    typeof code === 'string' && (FILE_NOT_FOUND_ERROR_CODES as readonly string[]).includes(code)
  );
}

export function isFileNotFoundException(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return isFileNotFoundCode((error as { code?: unknown }).code);
}

export function isFileNotFoundError(error: FileError): boolean {
  return error.type === 'fs-error' && isFileNotFoundCode(error.code);
}
