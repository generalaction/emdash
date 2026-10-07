import {
  isRuntimeResolveError,
  type RuntimeResolveError,
} from '@emdash/core/services/runtime-broker/api';
import { err } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import { runWithTimeout, systemClock, throwIfAborted } from '@emdash/shared/scheduling';
import {
  createProvider,
  type CreateProjectProviderDependencies,
} from '@core/features/projects/node/create-project-provider';
import type { ProjectAttachmentAdapter } from '@core/features/projects/node/project-attachment-manager';
import { fileKeyForAbsolutePath, hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import type { Project } from '@core/primitives/projects/api';
import { projectHostRef } from '@core/primitives/projects/api';
import { getProjectById } from './operations/getProjects';

const PROVIDER_TIMEOUT_MS = 60_000;

export function createProjectAttachmentAdapter(
  dependencies: CreateProjectProviderDependencies
): ProjectAttachmentAdapter {
  return {
    loadProject: (projectId) => getProjectById(dependencies.db, projectId),
    statRepository: async (project) => {
      const runtime = await dependencies.runtimes.client(projectHostRef(project));
      if (!runtime.success) return err(runtime.error);
      return runtime.data.files.fs.stat(fileKeyForAbsolutePath(hostPathFromNative(project.path)));
    },
    open: (project, signal) => openProvider(dependencies, project, signal),
  };
}

async function openProvider(
  dependencies: CreateProjectProviderDependencies,
  project: Project,
  signal: AbortSignal
) {
  try {
    return await runWithTimeout(
      async (attemptSignal) => {
        let result = await createProvider(dependencies, project, attemptSignal);
        if (project.type === 'local' && !result.success && result.error.type === 'timeout') {
          log.warn('Retrying Project initialization after a local runtime timeout', {
            projectId: project.id,
            error: result.error,
          });
          await systemClock.sleep(1_000, { signal: attemptSignal });
          result = await createProvider(dependencies, project, attemptSignal);
        }
        if (attemptSignal.aborted && result.success) await result.data.release();
        throwIfAborted(attemptSignal);
        if (result.success) return result;
        return err(
          result.error.type === 'timeout'
            ? { type: 'error' as const, message: result.error.message }
            : result.error
        );
      },
      { timeoutMs: PROVIDER_TIMEOUT_MS, signal }
    );
  } catch (error) {
    return err(toProviderOpenError(error));
  }
}

function toProviderOpenError(
  error: unknown
): RuntimeResolveError | { type: 'error'; message: string } {
  if (isRuntimeResolveError(error)) return error;
  return {
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  };
}
