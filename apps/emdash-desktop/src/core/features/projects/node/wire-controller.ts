import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { filesContract } from '@emdash/core/runtimes/files/api';
import { runtimeResolveErrorAsError } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import { LiveState } from '@emdash/wire';
import type {
  Contract,
  ContractImpl,
  GroupMutationEnvelope,
  LiveModelProvider,
  LiveSource,
} from '@emdash/wire';
import { expose, query } from '@emdash/wire/state';
import {
  projectsWireContract,
  type ProjectListData,
  type ProjectCreationState,
  type ProjectHostParams,
} from '@core/features/projects/api';
import { projectEvents } from '@core/features/projects/node';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import { appDbPokes } from '@core/services/app-db/node/pokes';
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
  const projectList = createProjectListProvider(projectOperations);
  return {
    impl: {
      createProject: (input) => projectOperations.createProject(input),
      inspectProjectPath: (input) => projectOperations.inspectProjectPath(input),
      initializeRepository: ({ projectId }) => projectOperations.initializeRepository(projectId),
      resolveRepositoryDestination: (input) =>
        projectOperations.resolveRepositoryDestination(input),
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
      createHostDirectory: async ({ host, root, path }) => {
        const runtime = await acquireHostRuntime(dependencies, host);
        return runtime.files.mutations.createDirectory({ root, path });
      },
      events: projectEvents,
      projectList,
      creation: createCreationProvider(),
      directoryTree: createDirectoryTreeModelProvider(dependencies),
      create: {
        run: (input, ctx) =>
          createProjectFromRemote(dependencies, input, ctx, publishCreationState),
        toError: unknownToWorkspaceError,
      },
      delete: (input) => enqueueDeleteProject(operations, input.projectId),
    },
    async dispose() {
      creationStates.clear();
      await projectList.dispose();
    },
  };
}

function createProjectListProvider(projectOperations: ReturnType<typeof createProjectOperations>) {
  return expose(projectsWireContract.projectList, {
    list: query<ProjectListData>({
      fetch: async () => ({ projects: await projectOperations.getProjects() }),
      pokes: [appDbPokes.projects.subscription()],
    }),
  });
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
