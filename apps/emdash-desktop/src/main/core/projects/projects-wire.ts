import type { WorkspaceError } from '@emdash/core/runtimes/workspace/api';
import { createController, exposeWireToWindows, LiveState, withValidation } from '@emdash/wire';
import type { LeasedLiveModelProvider, LiveJobContext } from '@emdash/wire';
import { ipcMain, MessageChannelMain } from 'electron';
import { appScope } from '@main/app/app-scope';
import { initializeProjectRepository } from '@main/core/project-setup/repository-setup';
import { createLocalProject } from '@main/core/projects/operations/create-local-project';
import { runCloneRepositoryProvision } from '@main/core/workspaces/workspace-bootstrap-service';
import {
  projectsWireContract,
  type CreateProjectFromRemoteInput,
  type ProjectCreationState,
} from '@shared/core/projects/wire-contract';
import { PROJECTS_WIRE_CHANNEL } from '@shared/core/runtime/wire-channels';
import type { WorkspaceBootstrapProgress } from '@shared/core/workspaces/wire-contract';
import type { LocalProject } from '@shared/projects';

type CreationKey = { projectId: string };
type CreationState = LiveState<ProjectCreationState>;

const scope = appScope.child('projects-wire');
const creationStates = new Map<string, CreationState>();

let installed = false;

export function installProjectsWire(): void {
  if (installed || typeof ipcMain?.handle !== 'function') return;
  installed = true;

  const controller = createController(projectsWireContract, {
    creation: createCreationProvider(),
    create: {
      run: (input, ctx) => runCreateProjectJob(input, ctx),
      toError: unknownToWorkspaceError,
    },
  });

  scope.add(
    exposeWireToWindows(
      { ipcMain, createMessageChannel },
      withValidation(projectsWireContract, controller, import.meta.env.DEV ? 'full' : 'inputs'),
      { channel: PROJECTS_WIRE_CHANNEL }
    )
  );
}

function createMessageChannel() {
  const channel = new MessageChannelMain();
  return { port1: channel.port1, port2: channel.port2 };
}

function createCreationProvider(): LeasedLiveModelProvider<typeof projectsWireContract.creation> {
  return {
    kind: 'leasedLiveModelProvider',
    contract: projectsWireContract.creation,
    acquireState(key, name) {
      return {
        ready: async () => {
          if (name !== 'state') throw new Error(`Unknown project creation state '${String(name)}'`);
          return ensureCreationState(key);
        },
        release: async () => {},
      };
    },
    async runMutation() {
      throw new Error('Project creation model does not expose mutations');
    },
    async dispose() {
      creationStates.clear();
    },
  };
}

async function runCreateProjectJob(
  input: CreateProjectFromRemoteInput,
  ctx: LiveJobContext<WorkspaceBootstrapProgress>
) {
  publishCreationState(input.projectId, { phase: 'cloning', message: 'Cloning repository…' });
  const clone = await runCloneRepositoryProvision({
    url: input.repositoryUrl,
    destination: input.targetPath,
    signal: ctx.signal,
    onProgress(progress) {
      ctx.progress(progress);
      publishCreationState(input.projectId, {
        phase: 'cloning',
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

  if (input.mode === 'new') {
    ctx.progress({
      step: 'initialising-workspace',
      message: 'Initializing repository…',
    });
    publishCreationState(input.projectId, {
      phase: 'initializing',
      message: 'Initializing repository…',
    });
    const initialized = await initializeProjectRepository({
      targetPath: input.targetPath,
      name: input.name,
      description: input.description,
    });
    if (!initialized.success) {
      const error = workspaceError('initialize-failed', initialized.error);
      publishCreationState(input.projectId, {
        phase: 'error',
        message: initialized.error,
        error,
      });
      return { success: false as const, error };
    }
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

function ensureCreationState(key: CreationKey): CreationState {
  const existing = creationStates.get(key.projectId);
  if (existing) return existing;
  const state = new LiveState<ProjectCreationState>({
    phase: 'cloning',
    message: 'Preparing project…',
  });
  creationStates.set(key.projectId, state);
  return state;
}

function publishCreationState(projectId: string, next: ProjectCreationState): void {
  ensureCreationState({ projectId }).replace(next);
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

function unknownToWorkspaceError(error: unknown): WorkspaceError {
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
