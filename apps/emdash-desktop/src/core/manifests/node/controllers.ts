import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import type { Scope } from '@emdash/shared/concurrency';
import {
  createController,
  forwardController,
  type Contract,
  type ContractDefinitions,
  type ContractImpl,
  type Controller,
} from '@emdash/wire/api';
import { projectsWireContract } from '@core/features/projects/api';
import { tasksWireContract } from '@core/features/tasks/api';
import { workspacesWireContract } from '@core/features/workspaces/api';
import type { CreateWorkspacesWireControllerOptions } from '@core/features/workspaces/node/wire-controller';
import type { WorkspaceIdentityService } from '@core/features/workspaces/node/workspace-identity-service';
import { desktopWireContract } from '@core/manifests/shared/desktop-wire-contract';
import { mementosWireContract } from '@core/primitives/mementos/api';
import { catalogWireContract } from '@core/services/catalog/api';
import { pullRequestsContract } from '@root/src/core/services/pull-requests/api';

export type DesktopControllerContext = {
  readonly scope: Scope;
  readonly runtimes: RuntimeBroker;
  readonly workspaceIdentity: WorkspaceIdentityService;
  readonly workspaces: Omit<
    CreateWorkspacesWireControllerOptions,
    'runtimes' | 'workspaceIdentity'
  >;
};

type DesktopDomain = Extract<keyof typeof desktopWireContract, string>;

export type DesktopNodeControllerContribution<Domain extends DesktopDomain = DesktopDomain> = {
  readonly contract: (typeof desktopWireContract)[Domain];
  readonly create: (context: DesktopControllerContext) => Controller | Promise<Controller>;
};

function controllerFromImpl<Defs extends ContractDefinitions>(
  contract: Contract<Defs>,
  owner: { impl: ContractImpl<Defs>; dispose(): Promise<void> },
  scope: Scope
): Controller {
  scope.add(() => owner.dispose());
  return createController(contract, owner.impl);
}

export const desktopNodeControllers = {
  account: {
    contract: desktopWireContract.account,
    create: async () => {
      const { createAccountWireController } =
        await import('@core/features/account/node/wire-controller');
      return createAccountWireController();
    },
  },
  agents: {
    contract: desktopWireContract.agents,
    create: async ({ runtimes }) => {
      const { createAgentsWireController } =
        await import('@core/features/agents/node/wire-controller');
      return createAgentsWireController({ runtimes });
    },
  },
  appSettings: {
    contract: desktopWireContract.appSettings,
    create: async () => {
      const { createAppSettingsWireController } =
        await import('@core/features/settings/node/wire-controller');
      return createAppSettingsWireController();
    },
  },
  editor: {
    contract: desktopWireContract.editor,
    create: async ({ runtimes, workspaceIdentity }) => {
      const { createEditorWireController } =
        await import('@core/features/editor/node/wire-controller');
      return createEditorWireController({ runtimes, workspaceIdentity });
    },
  },
  legacyPort: {
    contract: desktopWireContract.legacyPort,
    create: async () => {
      const { createLegacyPortWireController } =
        await import('@core/features/legacy-port/node/wire-controller');
      return createLegacyPortWireController();
    },
  },
  projectSettings: {
    contract: desktopWireContract.projectSettings,
    create: async () => {
      const { createProjectSettingsWireController } =
        await import('@core/features/workspaces/node/project-wire-controllers');
      return createProjectSettingsWireController();
    },
  },
  projectWorkspaces: {
    contract: desktopWireContract.projectWorkspaces,
    create: async () => {
      const { createProjectWorkspacesWireController } =
        await import('@core/features/workspaces/node/project-wire-controllers');
      return createProjectWorkspacesWireController();
    },
  },
  promptLibrary: {
    contract: desktopWireContract.promptLibrary,
    create: async () => {
      const { createPromptLibraryWireController } =
        await import('@core/features/library/node/wire-controller');
      return createPromptLibraryWireController();
    },
  },
  repository: {
    contract: desktopWireContract.repository,
    create: async () => {
      const { createRepositoryWireController } =
        await import('@core/features/repository/node/wire-controller');
      return createRepositoryWireController();
    },
  },
  search: {
    contract: desktopWireContract.search,
    create: async () => {
      const { createSearchWireController } =
        await import('@core/features/search/node/wire-controller');
      return createSearchWireController();
    },
  },
  telemetry: {
    contract: desktopWireContract.telemetry,
    create: async () => {
      const { createTelemetryWireController } =
        await import('@core/features/telemetry/node/wire-controller');
      return createTelemetryWireController();
    },
  },
  sourceControl: {
    contract: desktopWireContract.sourceControl,
    create: async ({ runtimes, workspaceIdentity }) => {
      const { createSourceControlWireController } =
        await import('@core/features/source-control/node/wire-controller');
      return createSourceControlWireController({ runtimes, workspaceIdentity });
    },
  },
  mcp: {
    contract: desktopWireContract.mcp,
    create: async ({ runtimes }) => {
      const { createMcpWireController } = await import('@core/features/mcp/node/wire-controller');
      return createMcpWireController({ runtimes });
    },
  },
  skills: {
    contract: desktopWireContract.skills,
    create: async ({ runtimes }) => {
      const { createSkillsWireController } =
        await import('@core/features/skills/node/wire-controller');
      return createSkillsWireController({ runtimes });
    },
  },
  terminals: {
    contract: desktopWireContract.terminals,
    create: async ({ runtimes, workspaceIdentity }) => {
      const { createTerminalsWireController } =
        await import('@core/features/terminals/node/wire-controller');
      return createTerminalsWireController({ runtimes, workspaceIdentity });
    },
  },
  mementos: {
    contract: desktopWireContract.mementos,
    create: async () => {
      const { getMementosRuntimeClient } = await import('@main/gateway/desktop-workers');
      return forwardController(mementosWireContract, await getMementosRuntimeClient());
    },
  },
  notifications: {
    contract: desktopWireContract.notifications,
    create: async () => {
      const [{ notificationService }, { createNotificationsWireController }] = await Promise.all([
        import('@root/src/core/services/notifications/node'),
        import('@root/src/core/services/notifications/node/wire-controller'),
      ]);
      return createNotificationsWireController(notificationService);
    },
  },
  pullRequests: {
    contract: desktopWireContract.pullRequests,
    create: async () => {
      const { getPullRequestsRuntimeClient } = await import('@main/gateway/desktop-workers');
      return forwardController(pullRequestsContract, await getPullRequestsRuntimeClient());
    },
  },
  catalog: {
    contract: desktopWireContract.catalog,
    create: async ({ scope }) => {
      const { createCatalogWireController } =
        await import('@core/services/catalog/node/wire-controller');
      return controllerFromImpl(catalogWireContract, createCatalogWireController(), scope);
    },
  },
  workspaces: {
    contract: desktopWireContract.workspaces,
    create: async ({ scope, workspaces, runtimes, workspaceIdentity }) => {
      const { createWorkspacesWireController } =
        await import('@core/features/workspaces/node/wire-controller');
      return controllerFromImpl(
        workspacesWireContract,
        createWorkspacesWireController({ ...workspaces, runtimes, workspaceIdentity }),
        scope
      );
    },
  },
  projects: {
    contract: desktopWireContract.projects,
    create: async ({ scope }) => {
      const { createProjectsWireController } =
        await import('@core/features/projects/node/wire-controller');
      return controllerFromImpl(projectsWireContract, createProjectsWireController(), scope);
    },
  },
  automations: {
    contract: desktopWireContract.automations,
    create: async () => {
      const { createAutomationsWireController } =
        await import('@core/features/automations/node/wire-controller');
      return createAutomationsWireController();
    },
  },
  browser: {
    contract: desktopWireContract.browser,
    create: async () => {
      const { createBrowserWireController } =
        await import('@core/features/browser/node/wire-controller');
      return createBrowserWireController();
    },
  },
  conversations: {
    contract: desktopWireContract.conversations,
    create: async ({ runtimes, workspaceIdentity }) => {
      const { createConversationsWireController } =
        await import('@core/features/conversations/node/wire-controller');
      return createConversationsWireController({ runtimes, workspaceIdentity });
    },
  },
  previewServers: {
    contract: desktopWireContract.previewServers,
    create: async () => {
      const { createPreviewServersWireController } =
        await import('@core/features/preview-servers/node/wire-controller');
      return createPreviewServersWireController();
    },
  },
  github: {
    contract: desktopWireContract.github,
    create: async () => {
      const { createGithubWireController } =
        await import('@core/features/github/node/wire-controller');
      return createGithubWireController();
    },
  },
  integrations: {
    contract: desktopWireContract.integrations,
    create: async () => {
      const { createIntegrationsWireController } =
        await import('@core/features/integrations/node/wire-controller');
      return createIntegrationsWireController();
    },
  },
  issues: {
    contract: desktopWireContract.issues,
    create: async () => {
      const { createIssuesWireController } =
        await import('@core/features/issues/node/wire-controller');
      return createIssuesWireController();
    },
  },
  ssh: {
    contract: desktopWireContract.ssh,
    create: async () => {
      const { createSshWireController } = await import('@core/features/ssh/node/wire-controller');
      return createSshWireController();
    },
  },
  tasks: {
    contract: desktopWireContract.tasks,
    create: async ({ scope }) => {
      const { createTasksWireController } =
        await import('@core/features/tasks/node/wire-controller');
      return controllerFromImpl(tasksWireContract, createTasksWireController(), scope);
    },
  },
  updates: {
    contract: desktopWireContract.updates,
    create: async () => {
      const { createUpdatesWireController } =
        await import('@core/features/updates/node/wire-controller');
      return createUpdatesWireController();
    },
  },
  host: {
    contract: desktopWireContract.host,
    create: async () => {
      const { createDesktopHostWireController } =
        await import('@core/features/workbench/node/wire-controller');
      return createDesktopHostWireController();
    },
  },
} satisfies {
  readonly [Domain in DesktopDomain]: DesktopNodeControllerContribution<Domain>;
};
