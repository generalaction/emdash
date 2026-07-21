import { readdir, rm, stat } from 'node:fs/promises';
import type { WorkspaceError } from '@emdash/core/runtimes/workspace/api';
import { log } from '@emdash/shared/logger';
import type { LiveJobContext } from '@emdash/wire';
import type {
  CreateProjectFromRemoteInput,
  ProjectCreationState,
} from '@core/features/projects/api';
import {
  createLocalProject,
  type LocalProjectOperationDependencies,
} from '@core/features/projects/node/operations/create-local-project';
import type { WorkspaceBootstrapProgress } from '@core/features/workspaces/api';
import { runCloneRepositoryProvision } from '@core/features/workspaces/api/node/workspace-bootstrap-service';
import type { LocalProject } from '@core/primitives/projects/api';
import type { WorkspaceRuntimeClient } from '@core/services/runtime-broker/api/clients';

export type ProjectCreationPublisher = (projectId: string, state: ProjectCreationState) => void;

export async function createProjectFromRemote(
  dependencies: LocalProjectOperationDependencies & {
    getWorkspaceRuntimeClient(): Promise<WorkspaceRuntimeClient>;
  },
  input: CreateProjectFromRemoteInput,
  ctx: LiveJobContext<WorkspaceBootstrapProgress>,
  publishCreationState: ProjectCreationPublisher
) {
  const targetStatus = await inspectTarget(input.targetPath);
  if (targetStatus === 'non-empty') {
    const error = workspaceError(
      'destination-not-empty',
      `Clone destination is not empty: ${input.targetPath}`
    );
    publishCreationState(input.projectId, { phase: 'error', message: error.message, error });
    return { success: false as const, error };
  }
  const targetExistedBeforeClone = targetStatus === 'empty-directory';
  publishCreationState(input.projectId, { phase: 'cloning', message: 'Cloning repository…' });
  const clone = await runCloneRepositoryProvision(dependencies.getWorkspaceRuntimeClient, {
    url: input.repositoryUrl,
    destination: input.targetPath,
    initialize:
      input.mode === 'new'
        ? {
            name: input.name,
            description: input.description,
          }
        : undefined,
    signal: ctx.signal,
    onProgress(progress) {
      ctx.progress(progress);
      publishCreationState(input.projectId, {
        phase: creationPhaseForProgress(input, progress),
        message: progress.message,
      });
    },
  });
  if (!clone.success) {
    if (clone.error.type === 'cancelled' && !targetExistedBeforeClone) {
      await cleanupCancelledCloneTarget(input.targetPath);
    }
    publishCreationState(input.projectId, {
      phase: 'error',
      message: clone.error.message,
      error: clone.error,
    });
    return clone;
  }

  publishCreationState(input.projectId, {
    phase: 'registering',
    message: 'Registering project…',
  });
  ctx.progress({
    step: 'initialising-workspace',
    message: 'Registering project…',
  });
  const project = await createLocalProject(dependencies, {
    id: input.projectId,
    path: input.targetPath,
    name: input.name,
  });
  if (!project.success) {
    const error = projectErrorToWorkspaceError(project.error);
    publishCreationState(input.projectId, {
      phase: 'error',
      message: error.message,
      error,
    });
    return { success: false as const, error };
  }
  if (project.data.type !== 'local') {
    const error = workspaceError('invalid-project-type', 'Expected a local project');
    publishCreationState(input.projectId, { phase: 'error', message: error.message, error });
    return { success: false as const, error };
  }

  publishCreationState(input.projectId, { phase: 'ready', project: project.data });
  return { success: true as const, data: project.data satisfies LocalProject };
}

async function inspectTarget(path: string): Promise<'missing' | 'empty-directory' | 'non-empty'> {
  try {
    const entry = await stat(path);
    if (!entry.isDirectory()) return 'non-empty';
    return (await readdir(path)).length === 0 ? 'empty-directory' : 'non-empty';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'missing';
    }
    return 'non-empty';
  }
}

async function cleanupCancelledCloneTarget(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch (error) {
    log.warn('Failed to clean up cancelled project clone target', {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function creationPhaseForProgress(
  input: CreateProjectFromRemoteInput,
  progress: WorkspaceBootstrapProgress
): 'cloning' | 'initializing' {
  if (input.mode !== 'new') return 'cloning';
  const activeStage =
    progress.operation?.stages.find((stage) => stage.status === 'running') ??
    progress.operation?.stages.find((stage) => stage.status === 'pending');
  return (activeStage?.id.startsWith('git-clone') ?? true) ? 'cloning' : 'initializing';
}

function workspaceError(type: string, message: string): WorkspaceError {
  return { type, message };
}

function projectErrorToWorkspaceError(error: unknown): WorkspaceError {
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { type?: unknown }).type === 'string'
  ) {
    const projectError = error as { type: string; path?: string; message?: string };
    return workspaceError(
      projectError.type,
      projectError.message ??
        `Project creation failed${projectError.path ? `: ${projectError.path}` : ''}`
    );
  }
  return unknownToWorkspaceError(error);
}

export function unknownToWorkspaceError(error: unknown): WorkspaceError {
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { type?: unknown }).type === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return error as WorkspaceError;
  }
  return workspaceError(
    'project-creation-failed',
    error instanceof Error ? error.message : String(error)
  );
}
