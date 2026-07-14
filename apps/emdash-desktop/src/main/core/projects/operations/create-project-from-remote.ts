import type { WorkspaceError } from '@emdash/core/runtimes/workspace/api';
import type { LiveJobContext } from '@emdash/wire';
import { createLocalProject } from '@main/core/projects/operations/create-local-project';
import { runCloneRepositoryProvision } from '@main/core/workspaces/workspace-bootstrap-service';
import type {
  CreateProjectFromRemoteInput,
  ProjectCreationState,
} from '@shared/core/projects/wire-contract';
import type { WorkspaceBootstrapProgress } from '@shared/core/workspaces/wire-contract';
import type { LocalProject } from '@shared/projects';

export type ProjectCreationPublisher = (projectId: string, state: ProjectCreationState) => void;

export async function createProjectFromRemote(
  input: CreateProjectFromRemoteInput,
  ctx: LiveJobContext<WorkspaceBootstrapProgress>,
  publishCreationState: ProjectCreationPublisher
) {
  publishCreationState(input.projectId, { phase: 'cloning', message: 'Cloning repository…' });
  const clone = await runCloneRepositoryProvision({
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
  const project = await createLocalProject({
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
