import type { FsError } from '@emdash/core/files';
import { err, ok, type Result } from '@emdash/shared';
import { isFileNotFoundError } from './scoped-file-system';

export type RealPathFileSystem = {
  realPath(path: string): Promise<Result<string, FsError>>;
};

export type RealPathPathOperations = {
  basename(path: string): string;
  contains(parent: string, child: string): boolean;
  dirname(path: string): string;
  join(basePath: string, ...segments: string[]): string;
};

export type RealPathContainmentOptions = {
  candidateMustExist?: boolean;
  candidateErrorMode?: 'outside' | 'error';
};

export async function realPathNearestExisting(
  fileSystem: RealPathFileSystem,
  pathOperations: RealPathPathOperations,
  absPath: string
): Promise<Result<string, FsError>> {
  let current = absPath;
  const tail: string[] = [];

  for (;;) {
    const real = await fileSystem.realPath(current);
    if (real.success) {
      return ok(
        tail.length ? pathOperations.join(real.data, ...tail.slice().reverse()) : real.data
      );
    }
    if (!isFileNotFoundError(real.error)) return real;

    const parent = pathOperations.dirname(current);
    if (parent === current || parent === '.' || parent === '') {
      return err({
        type: 'invalid-path',
        path: absPath,
        message: `No existing ancestor for path: ${absPath}`,
      });
    }
    tail.push(pathOperations.basename(current));
    current = parent;
  }
}

export async function isRealPathContained(
  fileSystem: RealPathFileSystem,
  pathOperations: RealPathPathOperations,
  rootPath: string,
  candidatePath: string,
  options: RealPathContainmentOptions = {}
): Promise<Result<boolean, FsError>> {
  const rootReal = await fileSystem.realPath(rootPath);
  if (!rootReal.success) return rootReal;

  const candidateReal = options.candidateMustExist
    ? await fileSystem.realPath(candidatePath)
    : await realPathNearestExisting(fileSystem, pathOperations, candidatePath);
  if (!candidateReal.success) {
    return options.candidateErrorMode === 'error' ? candidateReal : ok(false);
  }

  return ok(
    candidateReal.data === rootReal.data ||
      pathOperations.contains(rootReal.data, candidateReal.data)
  );
}
