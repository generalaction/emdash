import type { HostRef } from '@emdash/core/primitives/host/api';
import {
  absoluteDirname,
  ROOT_RELATIVE_PATH,
  type HostAbsolutePath,
  type PortableRelativePath,
} from '@emdash/core/primitives/path/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import {
  hostPathFromNative,
  nativePathFromHost,
  portablePath,
} from '@core/primitives/desktop-runtime/api';
import type { ProjectPathStatus } from '@core/primitives/projects/api';
import { fsErrorMessage } from '@core/services/runtime-broker/node/files';

export async function getProjectPathStatus(
  dependencies: { runtimes: Pick<RuntimeBroker, 'client'> },
  host: HostRef,
  path: string
): Promise<ProjectPathStatus> {
  try {
    const runtime = await dependencies.runtimes.client(host);
    if (!runtime.success) {
      return { isDirectory: false, isGitRepo: false, error: runtime.error };
    }

    const absolutePath = hostPathFromNative(path);
    const pathEntry = await runtime.data.files.fs.stat(fileKeyForAbsolutePath(absolutePath));
    if (!pathEntry.success) {
      if (pathEntry.error.type === 'not-found') {
        return { isDirectory: false, isGitRepo: false };
      }
      return {
        isDirectory: false,
        isGitRepo: false,
        error: { type: 'inspect-failed', path, message: fsErrorMessage(pathEntry.error) },
      };
    }
    if (pathEntry.data.type !== 'directory') {
      return { isDirectory: false, isGitRepo: false };
    }

    const inspection = await runtime.data.git.inspectPath({ path: absolutePath });
    if (inspection.kind === 'inspect-failed') {
      return {
        isDirectory: true,
        isGitRepo: false,
        error: {
          type: 'inspect-failed',
          path: nativePathFromHost(inspection.path),
          message: inspection.message,
        },
      };
    }
    return { isDirectory: true, isGitRepo: inspection.kind === 'repository' };
  } catch (error) {
    return {
      isDirectory: false,
      isGitRepo: false,
      error: { type: 'inspect-failed', path, message: String(error) },
    };
  }
}

export function fileKeyForAbsolutePath(path: HostAbsolutePath): {
  root: HostAbsolutePath;
  relative: PortableRelativePath;
} {
  const parent = absoluteDirname(path);
  if (!parent) return { root: path, relative: ROOT_RELATIVE_PATH };
  return {
    root: parent,
    relative: portablePath(path.segments.at(-1) ?? ''),
  };
}
