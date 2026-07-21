import { LiveState } from '@emdash/wire';
import type { Contract, ContractImpl, LeasedLiveModelProvider } from '@emdash/wire';
import { projectsWireContract, type ProjectCreationState } from '@core/features/projects/api';
import { projectEvents } from '@core/features/projects/node';
import type { OperationsEngine } from '@core/services/operations/node';
import { createProjectOperations, type ProjectOperationDependencies } from './controller';
import {
  createProjectFromRemote,
  unknownToWorkspaceError,
} from './operations/create-project-from-remote';
import { enqueueDeleteProject } from './operations/delete-project-definition';

type CreationKey = { projectId: string };
type CreationState = LiveState<ProjectCreationState>;
type ContractDefinitionsOf<TContract> = TContract extends Contract<infer Defs> ? Defs : never;
type ProjectsWireImpl = ContractImpl<ContractDefinitionsOf<typeof projectsWireContract>>;

export type ProjectsWireController = {
  impl: ProjectsWireImpl;
  dispose(): Promise<void>;
};

const creationStates = new Map<string, CreationState>();

export function createProjectsWireController(
  dependencies: ProjectOperationDependencies
): ProjectsWireController {
  const { operations } = dependencies;
  const projectOperations = createProjectOperations(dependencies);
  return {
    impl: {
      createProject: (input) => projectOperations.createProject(input),
      inspectProjectPath: (input) => projectOperations.inspectProjectPath(input),
      resolveRepositoryDestination: (input) =>
        projectOperations.resolveRepositoryDestination(input),
      getProjects: () => projectOperations.getProjects(),
      deleteProject: ({ projectId }) => projectOperations.deleteProject(projectId),
      getProjectSettingsPage: ({ projectId }) =>
        projectOperations.getProjectSettingsPage(projectId),
      updateProjectSettings: ({ projectId, settings }) =>
        projectOperations.updateProjectSettings(projectId, settings),
      patchProjectSettings: ({ projectId, patch }) =>
        projectOperations.patchProjectSettings(projectId, patch),
      shareProjectSettingsToConfig: ({ projectId, request }) =>
        projectOperations.shareProjectSettingsToConfig(projectId, request),
      migrateProjectConfig: ({ projectId, request }) =>
        projectOperations.migrateProjectConfig(projectId, request),
      countProjectsUsingGithubAccount: ({ accountId }) =>
        projectOperations.countProjectsUsingGithubAccount(accountId),
      updateProjectConnection: ({ projectId, connectionId }) =>
        projectOperations.updateProjectConnection(projectId, connectionId),
      openProject: ({ projectId }) => projectOperations.openProject(projectId),
      events: projectEvents,
      creation: createCreationProvider(),
      create: {
        run: (input, ctx) =>
          createProjectFromRemote(dependencies, input, ctx, publishCreationState),
        toError: unknownToWorkspaceError,
      },
      delete: (input) => enqueueDeleteProject(operations, input.projectId),
      retryDelete: (input) => operations.retryDelete('project', input.projectId),
      forgetWithoutCleanup: (input) => operations.forgetWithoutCleanup('project', input.projectId),
      deletions: createProjectDeletionsProvider(operations),
    },
    async dispose() {
      creationStates.clear();
    },
  };
}

function createProjectDeletionsProvider(
  operations: OperationsEngine
): LeasedLiveModelProvider<typeof projectsWireContract.deletions> {
  return {
    kind: 'leasedLiveModelProvider',
    contract: projectsWireContract.deletions,
    acquireState(key, name) {
      let lease: ReturnType<OperationsEngine['acquireDeletionState']> | undefined;
      let released = false;
      return {
        ready: async () => {
          if (name !== 'list') {
            throw new Error(`Unknown project deletion state '${String(name)}'`);
          }
          if (released) throw new Error('Project deletion state lease was released before ready');
          lease ??= operations.acquireDeletionState('project', key.entityId);
          if (released) {
            await lease.release();
            throw new Error('Project deletion state lease was released before ready');
          }
          return lease.ready();
        },
        release: async () => {
          released = true;
          await lease?.release();
        },
      };
    },
    async runMutation() {
      throw new Error('Project deletions model does not expose mutations');
    },
    async dispose() {},
  };
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
