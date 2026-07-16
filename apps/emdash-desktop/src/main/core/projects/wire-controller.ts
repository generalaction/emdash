import { LiveState } from '@emdash/wire';
import type { Contract, ContractImpl, LeasedLiveModelProvider } from '@emdash/wire';
import type { OperationsService } from '@main/core/operations/operations-service';
import {
  projectsWireContract,
  type ProjectCreationState,
} from '@shared/core/projects/wire-contract';
import {
  createProjectFromRemote,
  unknownToWorkspaceError,
} from './operations/create-project-from-remote';

type CreationKey = { projectId: string };
type CreationState = LiveState<ProjectCreationState>;
type ContractDefinitionsOf<TContract> = TContract extends Contract<infer Defs> ? Defs : never;
type ProjectsWireImpl = ContractImpl<ContractDefinitionsOf<typeof projectsWireContract>>;

export type ProjectsWireController = {
  impl: ProjectsWireImpl;
  dispose(): Promise<void>;
};

const creationStates = new Map<string, CreationState>();

export function createProjectsWireController(): ProjectsWireController {
  return {
    impl: {
      creation: createCreationProvider(),
      create: {
        run: (input, ctx) => createProjectFromRemote(input, ctx, publishCreationState),
        toError: unknownToWorkspaceError,
      },
      delete: async (input) => {
        const operationsService = await getOperationsService();
        await operationsService.initialize();
        return operationsService.enqueueDeleteProject(input.projectId);
      },
      retryDelete: async (input) => {
        const operationsService = await getOperationsService();
        await operationsService.initialize();
        return operationsService.retryDelete('project', input.projectId);
      },
      forgetWithoutCleanup: async (input) => {
        const operationsService = await getOperationsService();
        await operationsService.initialize();
        return operationsService.forgetWithoutCleanup('project', input.projectId);
      },
      deletions: createProjectDeletionsProvider(),
    },
    async dispose() {
      creationStates.clear();
    },
  };
}

function createProjectDeletionsProvider(): LeasedLiveModelProvider<
  typeof projectsWireContract.deletions
> {
  return {
    kind: 'leasedLiveModelProvider',
    contract: projectsWireContract.deletions,
    acquireState(key, name) {
      let lease: ReturnType<OperationsService['acquireDeletionState']> | undefined;
      let released = false;
      return {
        ready: async () => {
          if (name !== 'list') {
            throw new Error(`Unknown project deletion state '${String(name)}'`);
          }
          if (released) throw new Error('Project deletion state lease was released before ready');
          const operationsService = await getOperationsService();
          await operationsService.initialize();
          lease ??= operationsService.acquireDeletionState('project', key.entityId);
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

async function getOperationsService(): Promise<OperationsService> {
  return (await import('@main/core/operations/operations-service')).operationsService;
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
