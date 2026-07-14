import { LiveState } from '@emdash/wire';
import type { Contract, ContractImpl, LeasedLiveModelProvider } from '@emdash/wire';
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
    },
    async dispose() {
      creationStates.clear();
    },
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
