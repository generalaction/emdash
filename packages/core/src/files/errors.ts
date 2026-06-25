export type FilesOnError = (context: string, error: unknown) => void;

export type FileError =
  | { type: 'invalid-path'; path: string; message: string }
  | { type: 'fs-error'; path: string; message: string; code?: string };

export function classifyFileError(error: unknown, path: string): FileError {
  const code = (error as { code?: unknown } | undefined)?.code;
  return {
    type: 'fs-error',
    path,
    message: error instanceof Error ? error.message : String(error),
    ...(typeof code === 'string' ? { code } : {}),
  };
}
