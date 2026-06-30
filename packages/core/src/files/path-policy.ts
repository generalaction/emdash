import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import type { FileError } from './errors';
import { contains, validateAbsolutePath, type AbsPath } from './paths';

export type RootPathPolicy = {
  readonly rootPath: AbsPath;
  resolveInsideRoot(inputPath: string): Result<AbsPath, FileError>;
  contains(inputPath: string): boolean;
  relativeParts(inputPath: string): Result<string[], FileError>;
  absoluteFromWatchEvent(eventPath: string): AbsPath | null;
};

export function createRootPathPolicy(rootPath: string): Result<RootPathPolicy, FileError> {
  const validatedRoot = validateAbsolutePath(rootPath);
  if (!validatedRoot.success) return validatedRoot;

  const normalizedRoot = path.resolve(validatedRoot.data);

  const resolveInsideRoot = (inputPath: string): Result<AbsPath, FileError> => {
    const absPath = inputPath ? inputPath : normalizedRoot;
    const validated = validateAbsolutePath(absPath);
    if (!validated.success) return validated;
    if (!contains(normalizedRoot, validated.data)) {
      return err({
        type: 'invalid-path',
        path: inputPath,
        message: 'Path is outside tree root',
      });
    }
    return ok(validated.data);
  };

  return ok({
    rootPath: normalizedRoot,
    resolveInsideRoot,
    contains(inputPath: string): boolean {
      const validated = validateAbsolutePath(inputPath);
      return validated.success && contains(normalizedRoot, validated.data);
    },
    relativeParts(inputPath: string): Result<string[], FileError> {
      const resolved = resolveInsideRoot(inputPath);
      if (!resolved.success) return resolved;
      return ok(path.relative(normalizedRoot, resolved.data).split(path.sep).filter(Boolean));
    },
    absoluteFromWatchEvent(eventPath: string): AbsPath | null {
      const relative = path.relative(normalizedRoot, eventPath).replace(/\\/g, '/');
      if (
        !relative ||
        relative === '..' ||
        relative.startsWith('../') ||
        path.isAbsolute(relative)
      ) {
        return null;
      }
      const absPath = path.normalize(eventPath);
      return contains(normalizedRoot, absPath) ? absPath : null;
    },
  });
}
