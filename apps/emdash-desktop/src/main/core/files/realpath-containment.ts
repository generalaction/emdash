import {
  absoluteBasename,
  absoluteDirname,
  createPathSemantics,
  formatAbsolute,
  type HostAbsolutePath,
} from '@emdash/core/primitives/path/api';
import type { FsError } from '@emdash/core/runtimes/files/api';
import { err, ok, type Result } from '@emdash/shared';
import {
  fileKey,
  isFileNotFoundError,
  type FilesClientScope,
} from '@core/services/runtime-broker/node/files';

export type RealPathContainmentOptions = {
  candidateMustExist?: boolean;
  candidateErrorMode?: 'outside' | 'error';
};

export async function realPathNearestExisting(
  files: FilesClientScope,
  absPath: HostAbsolutePath
): Promise<Result<HostAbsolutePath, FsError>> {
  let current = absPath;
  const tail: string[] = [];

  for (;;) {
    const real = await files.client.fs.realPath(fileKey(files, current));
    if (real.success) {
      return ok({
        root: real.data.path.root,
        segments: [...real.data.path.segments, ...tail.reverse()],
      });
    }
    if (!isFileNotFoundError(real.error)) return real;

    const parent = absoluteDirname(current);
    if (!parent) {
      return err({
        type: 'invalid-path',
        path: formatAbsolute(absPath),
        message: `No existing ancestor for path: ${formatAbsolute(absPath)}`,
      });
    }
    tail.push(absoluteBasename(current));
    current = parent;
  }
}

export async function isRealPathContained(
  files: FilesClientScope,
  rootPath: HostAbsolutePath,
  candidatePath: HostAbsolutePath,
  options: RealPathContainmentOptions = {}
): Promise<Result<boolean, FsError>> {
  const rootReal = await files.client.fs.realPath(fileKey(files, rootPath));
  if (!rootReal.success) return rootReal;

  const candidateReal = options.candidateMustExist
    ? await files.client.fs
        .realPath(fileKey(files, candidatePath))
        .then((result) => (result.success ? ok(result.data.path) : result))
    : await realPathNearestExisting(files, candidatePath);
  if (!candidateReal.success) {
    return options.candidateErrorMode === 'error' ? candidateReal : ok(false);
  }

  return ok(createPathSemantics(files.profile).contains(rootReal.data.path, candidateReal.data));
}
