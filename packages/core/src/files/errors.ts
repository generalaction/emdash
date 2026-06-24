export type FilesOnError = (context: string, error: unknown) => void;

export type FileError =
  | { type: 'invalid-path'; path: string; message: string }
  | { type: 'fs-error'; path: string; message: string };

export function classifyFileError(error: unknown, path: string): FileError {
  return { type: 'fs-error', path, message: String(error) };
}
