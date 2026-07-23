import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { filesContract } from '@emdash/core/runtimes/files/api';
import { runtimeResolveErrorAsError } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import { LiveState } from '@emdash/wire';
import type {
  Contract,
  ContractImpl,
  GroupMutationEnvelope,
  LeasedLiveModelProvider,
  LiveModelProvider,
  LiveSource,
} from '@emdash/wire';
import {
  projectsWireContract,
  type ProjectCreationState,
  type ProjectHostParams,
} from '@core/features/projects/api';
import { projectEvents } from '@core/features/projects/node';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
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
      getHostHomeDir: async (input) => {
        const runtime = await acquireHostRuntime(dependencies, input);
        return nativePathFromHost(await runtime.files.getHomeDir());
      },
      events: projectEvents,
      creation: createCreationProvider(),
      directoryTree: createDirectoryTreeModelProvider(dependencies),
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

function createDirectoryTreeModelProvider(
  dependencies: ProjectOperationDependencies
): LiveModelProvider<typeof projectsWireContract.directoryTree> {
  const contract = projectsWireContract.directoryTree;
  return {
    kind: 'liveModelProvider',
    contract,
    resolveState: (key, name) =>
      resolveHostRuntimeSource(dependencies, key, (runtime) =>
        runtime.files.tree.model
          .state(
            {
              root: key.root,
              sessionId: key.sessionId,
            },
            name
          )
          .asLiveSource()
      ),
    async runMutation(name, envelope) {
      const runtimeResult = await dependencies.runtimes.client(hostRefForProjectHost(envelope.key));
      if (!runtimeResult.success) {
        return err(runtimeResult.error) as unknown as Awaited<
          ReturnType<LiveModelProvider<typeof contract>['runMutation']>
        >;
      }
      const result = await runtimeResult.data.files.tree.model.mutate(name, {
        ...envelope,
        key: {
          root: envelope.key.root,
          sessionId: envelope.key.sessionId,
        },
      } as unknown as GroupMutationEnvelope<typeof filesContract.tree.model, typeof name>);
      return rebindMutationCursors(
        result,
        filesContract.tree.model,
        projectsWireContract.directoryTree,
        envelope.key
      ) as unknown as Awaited<ReturnType<LiveModelProvider<typeof contract>['runMutation']>>;
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

function createCreationProvider(): LiveModelProvider<typeof projectsWireContract.creation> {
  return {
    kind: 'liveModelProvider',
    contract: projectsWireContract.creation,
    resolveState(key, name) {
      if (name !== 'state') throw new Error(`Unknown project creation state '${String(name)}'`);
      return ensureCreationState(key);
    },
    async runMutation() {
      throw new Error('Project creation model does not expose mutations');
    },
  };
}

async function acquireHostRuntime(
  dependencies: ProjectOperationDependencies,
  host: ProjectHostParams
) {
  const runtime = await dependencies.runtimes.client(hostRefForProjectHost(host));
  if (!runtime.success) throw runtimeResolveErrorAsError(runtime.error);
  return runtime.data;
}

async function resolveHostRuntimeSource(
  dependencies: ProjectOperationDependencies,
  host: ProjectHostParams,
  source: (runtime: Awaited<ReturnType<typeof acquireHostRuntime>>) => LiveSource
): Promise<LiveSource> {
  const runtime = await acquireHostRuntime(dependencies, host);
  return source(runtime);
}

function hostRefForProjectHost(host: ProjectHostParams) {
  return host.type === 'ssh' ? hostRef('remote', host.connectionId) : LOCAL_HOST_REF;
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

function rebindMutationCursors<
  ResultType extends Result<{ data: unknown; cursors: readonly { model: string }[] }, unknown>,
>(
  result: ResultType,
  source: { states: Record<string, { id: string }> },
  target: { states: Record<string, { id: string }> },
  key: unknown
): ResultType {
  if (!result.success) return result;
  const ids = new Map(
    Object.entries(source.states).flatMap(([name, state]) => {
      const targetState = target.states[name];
      return targetState ? [[state.id, targetState.id] as const] : [];
    })
  );
  return ok({
    ...result.data,
    cursors: result.data.cursors.map((cursor) => ({
      ...cursor,
      model: ids.get(cursor.model) ?? cursor.model,
      key,
    })),
  }) as unknown as ResultType;
}
