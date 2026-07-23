import { hostRef } from '@emdash/core/primitives/host/api';
import {
  absoluteDirname,
  ROOT_RELATIVE_PATH,
  type HostAbsolutePath,
  type PortableRelativePath,
} from '@emdash/core/primitives/path/api';
import { err } from '@emdash/shared';
import {
  hostPathFromNative,
  nativePathFromHost,
  portablePath,
} from '@core/primitives/desktop-runtime/api';
import { remoteRuntimeUnavailable } from '@core/primitives/desktop-runtime/api/runtime-errors';
import type { CreateProjectResult, ProjectPathStatus } from '@core/primitives/projects/api';
import { fsErrorMessage } from '@core/services/runtime-broker/node/files';
import type { LocalProjectOperationDependencies } from './create-local-project';

export type CreateSshProjectParams = {
  id?: string;
  name: string;
  path: string;
  connectionId: string;
  initGitRepository?: boolean;
};

export async function createSshProject(
  params: CreateSshProjectParams
): Promise<CreateProjectResult> {
  return err(remoteRuntimeUnavailable(params.connectionId, 'projects'));
}

export async function getSshProjectPathStatus(
  dependencies: Pick<LocalProjectOperationDependencies, 'runtimes'>,
  path: string,
  connectionId: string
): Promise<ProjectPathStatus> {
  try {
    const runtime = await dependencies.runtimes.client(hostRef('remote', connectionId));
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

function fileKeyForAbsolutePath(path: HostAbsolutePath): {
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
