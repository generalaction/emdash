import { cp, lstat, mkdir, open, rename, rm, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import type { PortableRelativePath } from '@primitives/path/api';
import type { FsError } from '@runtimes/files/api';
import { toFsError } from '@runtimes/files/node/api/errors';
import type { RootChange, RootResource } from '@runtimes/files/node/root/root-resource';

export async function createFileInRoot(
  root: RootResource,
  input: { path: PortableRelativePath; content?: string }
): Promise<Result<RootChange[], FsError>> {
  const destination = await root.paths.resolveDestination(input.path);
  if (!destination.success) return destination;
  return root.runFileMutation(destination.data.absolutePath, async () => {
    try {
      const handle = await open(destination.data.absolutePath, 'wx');
      try {
        if (input.content !== undefined) await handle.writeFile(input.content, 'utf8');
      } finally {
        await handle.close();
      }
      return ok<RootChange[]>([{ kind: 'create', path: destination.data.path }]);
    } catch (error) {
      return err(toFsError(error, destination.data.path));
    }
  });
}

export async function createDirectoryInRoot(
  root: RootResource,
  input: { path: PortableRelativePath }
): Promise<Result<RootChange[], FsError>> {
  const destination = await root.paths.resolveDestination(input.path);
  if (!destination.success) return destination;
  return root.runFileMutation(destination.data.absolutePath, async () => {
    try {
      await mkdir(destination.data.absolutePath);
      return ok<RootChange[]>([{ kind: 'create', path: destination.data.path }]);
    } catch (error) {
      return err(toFsError(error, destination.data.path));
    }
  });
}

export async function renameInRoot(
  root: RootResource,
  input: { from: PortableRelativePath; to: PortableRelativePath }
): Promise<Result<RootChange[], FsError>> {
  if (path.posix.dirname(input.from) !== path.posix.dirname(input.to)) {
    return err({
      type: 'invalid-path',
      path: input.to,
      message: 'Rename requires the same parent',
    });
  }
  return moveInRoot(root, input);
}

export async function moveInRoot(
  root: RootResource,
  input: { from: PortableRelativePath; to: PortableRelativePath }
): Promise<Result<RootChange[], FsError>> {
  const source = await root.paths.resolveExistingEntry(input.from);
  if (!source.success) return source;
  if (source.data.path === '') {
    return err({
      type: 'invalid-path',
      path: '',
      message: 'The workspace root cannot be moved',
    });
  }
  const destination = await root.paths.resolveDestination(input.to);
  if (!destination.success) return destination;
  const available = await destinationAvailable(
    destination.data.absolutePath,
    destination.data.path
  );
  if (!available.success) return available;
  return root.runFileMutation(source.data.absolutePath, async () => {
    try {
      await rename(source.data.absolutePath, destination.data.absolutePath);
      return ok<RootChange[]>([
        { kind: 'delete', path: source.data.path },
        { kind: 'create', path: destination.data.path },
      ]);
    } catch (error) {
      return err(toFsError(error, source.data.path));
    }
  });
}

export async function copyInRoot(
  root: RootResource,
  input: { from: PortableRelativePath; to: PortableRelativePath }
): Promise<Result<RootChange[], FsError>> {
  if (input.to.startsWith(`${input.from}/`)) {
    return err({
      type: 'invalid-path',
      path: input.to,
      message: 'A directory cannot be copied into itself',
    });
  }
  const source = await root.paths.resolveExistingEntry(input.from);
  if (!source.success) return source;
  if (source.data.path === '') {
    return err({
      type: 'invalid-path',
      path: '',
      message: 'The workspace root cannot be copied',
    });
  }
  const destination = await root.paths.resolveDestination(input.to);
  if (!destination.success) return destination;
  const available = await destinationAvailable(
    destination.data.absolutePath,
    destination.data.path
  );
  if (!available.success) return available;
  return root.runFileMutation(source.data.absolutePath, async () => {
    try {
      await cp(source.data.absolutePath, destination.data.absolutePath, {
        recursive: true,
        force: false,
        errorOnExist: true,
        verbatimSymlinks: true,
      });
      return ok<RootChange[]>([{ kind: 'create', path: destination.data.path }]);
    } catch (error) {
      return err(toFsError(error, source.data.path));
    }
  });
}

export async function deleteInRoot(
  root: RootResource,
  input: { path: PortableRelativePath; recursive?: boolean }
): Promise<Result<RootChange[], FsError>> {
  const target = await root.paths.resolveExistingEntry(input.path);
  if (!target.success) return target;
  if (target.data.path === '') {
    return err({
      type: 'invalid-path',
      path: '',
      message: 'The workspace root cannot be deleted',
    });
  }
  return root.runFileMutation(target.data.absolutePath, async () => {
    try {
      const metadata = await lstat(target.data.absolutePath);
      if (metadata.isDirectory()) {
        if (input.recursive) await rm(target.data.absolutePath, { recursive: true });
        else await rmdir(target.data.absolutePath);
      } else {
        await unlink(target.data.absolutePath);
      }
      return ok<RootChange[]>([{ kind: 'delete', path: target.data.path }]);
    } catch (error) {
      return err(toFsError(error, target.data.path));
    }
  });
}

async function destinationAvailable(
  absolutePath: string,
  relativePath: string
): Promise<Result<void, FsError>> {
  try {
    await lstat(absolutePath);
    return err({ type: 'already-exists', path: relativePath });
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? ok<void>()
      : err(toFsError(error, relativePath));
  }
}
