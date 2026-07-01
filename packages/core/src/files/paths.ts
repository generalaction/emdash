import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import type { FileError } from './errors';

export type AbsPath = string;

export function validateAbsolutePath(input: string): Result<AbsPath, FileError> {
  if (input.includes('\0')) {
    return err({ type: 'invalid-path', path: input, message: 'Path contains a null byte' });
  }
  if (!path.isAbsolute(input) && !path.win32.isAbsolute(input)) {
    return err({ type: 'invalid-path', path: input, message: 'Path must be absolute' });
  }
  return ok(path.normalize(input));
}

export function contains(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !path.isAbsolute(rel));
}
