import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { runtimeResolveErrorAsError } from '@emdash/core/services/runtime-broker/api';
import { err, ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import type { Contract, ContractImpl, LeasedLiveModelProvider } from '@emdash/wire/rpc';
import { cell, expose, family, query, type Cell, type Family } from '@emdash/wire/state';
import {
  projectsWireContract,
  type ProjectListData,
  type ProjectCreationState,
  type ProjectHostParams,
} from '@core/features/projects/api';
import { projectEvents } from '@core/features/projects/node';
import { nativePathFromHost, resolveRelativePath } from '@core/primitives/desktop-runtime/api';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { forwardLiveModel } from '@core/services/runtime-clients/node/forward-live-model';
import { createProjectOperations, type ProjectOperationDependencies } from './controller';
import {
  createProjectFromRemote,
  unknownToProjectCreationError,
} from './operations/create-project-from-remote';
import { deleteProject } from './operations/deleteProject';

type CreationKey = { projectId: string };
type ContractDefinitionsOf<TContract> = TContract extends Contract<infer Defs> ? Defs : never;
type ProjectsWireImpl = ContractImpl<ContractDefinitionsOf<typeof projectsWireContract>>;
type CreationProvider = {
  provider: LeasedLiveModelProvider<typeof projectsWireContract.creation>;
  publish(projectId: string, next: ProjectCreationState): void;
  retain(projectId: string): () => void;
  dispose(): Promise<void>;
};

export type ProjectsWireController = {
  impl: ProjectsWireImpl;
  dispose(): Promise<void>;
};

export function createProjectsWireController(
  dependencies: ProjectOperationDependencies
): ProjectsWireController {
  const projectOperations = createProjectOperations(dependencies);
  const projectList = createProjectListProvider(projectOperations);
  const creation = createCreationProvider();
  const attachments = expose(projectsWireContract.attachments, {
    state: ({ projectId }, scope) => dependencies.projects.track(projectId, scope),
  });
  return {
    impl: {
      createProject: (input) => projectOperations.createProject(input),
      inspectProjectPath: (input) => projectOperations.inspectProjectPath(input),
      initializeRepository: ({ projectId }) => projectOperations.initializeRepository(projectId),
      resolveRepositoryDestination: (input) =>
        projectOperations.resolveRepositoryDestination(input),
      getDefaultRepositoriesRoot: (host) =>
        projectOperations.getDefaultRepositoriesRoot(hostRefForProjectHost(host)),
      ensureDefaultRepositoriesRoot: (host) =>
        projectOperations.ensureDefaultRepositoriesRoot(hostRefForProjectHost(host)),
      deleteProject: ({ projectId }) => projectOperations.deleteProject(projectId),
      getProjectSettingsPage: ({ projectId }) =>
        projectOperations.getProjectSettingsPage(projectId),
      updateProjectSettings: ({ projectId, patch }) =>
        projectOperations.updateProjectSettings(projectId, patch),
      shareProjectSettingsToConfig: ({ projectId, request }) =>
        projectOperations.shareProjectSettingsToConfig(projectId, request),
      migrateProjectConfig: ({ projectId, request }) =>
        projectOperations.migrateProjectConfig(projectId, request),
      countProjectsUsingProviderAccount: ({ providerId, accountId }) =>
        projectOperations.countProjectsUsingProviderAccount(providerId, accountId),
      updateProjectConnection: ({ projectId, connectionId }) =>
        projectOperations.updateProjectConnection(projectId, connectionId),
      renameProject: ({ projectId, name }) => projectOperations.renameProject(projectId, name),
      recoverAttachment: ({ projectId }) => dependencies.projects.recover(projectId),
      getHostHomeDir: async (input) => {
        const runtime = await acquireHostRuntime(dependencies, input);
        return nativePathFromHost((await runtime.files.getHomeDir()).path);
      },
      createHostDirectory: async ({ host, root, path }) => {
        const runtime = await acquireHostRuntime(dependencies, host);
        return runtime.files.fs.createDirectory({ path: resolveRelativePath(root, path) });
      },
      listHostDirectory: async ({ host, path }) => {
        const runtime = await acquireHostRuntime(dependencies, host);
        return runtime.files.fs.listDirectory({ path });
      },
      events: projectEvents,
      projectList,
      attachments,
      projectConfig: forwardLiveModel(projectsWireContract.projectConfig, ({ projectId }) =>
        dependencies.projectSettings.getProjectConfigLiveSource(projectId)
      ),
      creation: creation.provider,
      create: {
        run: (input, ctx) => runCreateProjectFromRemote(dependencies, creation, input, ctx),
        toError: unknownToProjectCreationError,
      },
      // Plain deletion (no kernel submit); the contract's mutation-result shape stays
      // for wire compatibility, with no operation id to report.
      delete: async (input) => {
        const result = await deleteProject(dependencies.projectDeletion, input.projectId);
        return result.success ? ok({}) : err(result.error);
      },
    },
    async dispose() {
      await creation.dispose();
      await attachments.dispose();
      await projectList.dispose();
    },
  };
}

function createProjectListProvider(projectOperations: ReturnType<typeof createProjectOperations>) {
  const scope = createScope({ label: 'project-list-provider' });
  return expose(
    projectsWireContract.projectList,
    {
      list: query<ProjectListData>({
        fetch: async () => ({ projects: await projectOperations.getProjects() }),
        pokes: [appDbPokes.projects.subscription()],
        scope,
      }),
    },
    { scope }
  );
}

function createCreationProvider(): CreationProvider {
  const states: Family<CreationKey, Cell<ProjectCreationState>> = family(
    () =>
      cell<ProjectCreationState>({
        phase: 'cloning',
        message: 'Preparing project...',
      }),
    { name: 'project-creation' }
  );
  const provider = expose(projectsWireContract.creation, {
    state: (key, scope) => {
      const release = states.retain(key);
      scope.add(release);
      return states(key);
    },
  });
  return {
    provider,
    publish(projectId, next) {
      states({ projectId }).set(next);
    },
    retain(projectId) {
      return states.retain({ projectId });
    },
    async dispose() {
      await provider.dispose();
      await states.dispose();
    },
  };
}

async function runCreateProjectFromRemote(
  dependencies: ProjectOperationDependencies,
  creation: CreationProvider,
  input: Parameters<typeof createProjectFromRemote>[1],
  ctx: Parameters<typeof createProjectFromRemote>[2]
) {
  const release = creation.retain(input.projectId);
  try {
    return await createProjectFromRemote(dependencies, input, ctx, (projectId, next) =>
      creation.publish(projectId, next)
    );
  } finally {
    release();
  }
}

async function acquireHostRuntime(
  dependencies: ProjectOperationDependencies,
  host: ProjectHostParams
) {
  const runtime = await dependencies.runtimes.client(hostRefForProjectHost(host));
  if (!runtime.success) throw runtimeResolveErrorAsError(runtime.error);
  return runtime.data;
}

function hostRefForProjectHost(host: ProjectHostParams) {
  return host.type === 'ssh' ? hostRef('remote', host.connectionId) : LOCAL_HOST_REF;
}
