import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import type { Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import {
  createController,
  forwardController,
  type Contract,
  type ContractDefinitions,
  type ContractImpl,
  type Controller,
} from '@emdash/wire/api';
import type { EmdashAccountService } from '@core/features/account/node/services/emdash-account-service';
import { createAccountWireController } from '@core/features/account/node/wire-controller';
import { createAgentOperations } from '@core/features/agents/node/controller';
import { createAgentsWireController } from '@core/features/agents/node/wire-controller';
import type { AutomationsService } from '@core/features/automations/api/node/automations-service';
import { createAutomationsWireController } from '@core/features/automations/node/wire-controller';
import {
  createBrowserWireController,
  type BrowserOperations,
} from '@core/features/browser/node/wire-controller';
import { createCatalogWireController } from '@core/features/catalog/node/wire-controller';
import type { CompensationRunner } from '@core/features/conversations/node/createConversation';
import { createConversationsWireController } from '@core/features/conversations/node/wire-controller';
import type { EditorBufferService } from '@core/features/editor/node/editor-buffer-service';
import { createEditorWireController } from '@core/features/editor/node/wire-controller';
import { createGithubWireController } from '@core/features/github/node/wire-controller';
import { createIntegrationsWireController } from '@core/features/integrations/node/wire-controller';
import type { IssueProviderRegistry } from '@core/features/issues/node/registry';
import { createIssuesWireController } from '@core/features/issues/node/wire-controller';
import {
  createLegacyPortWireController,
  type LegacyPortControllerOperations,
} from '@core/features/legacy-port/node/wire-controller';
import type { PromptLibraryService } from '@core/features/library/node/prompt-library-service';
import { createPromptLibraryWireController } from '@core/features/library/node/wire-controller';
import { createMachinesWireController } from '@core/features/machines/node/wire-controller';
import { createMcpWireController } from '@core/features/mcp/node/wire-controller';
import { createPreviewServersWireController } from '@core/features/preview-servers/node/wire-controller';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import type { ProjectSettingsService } from '@core/features/projects/api/node/settings/project-settings-service';
import { createProjectsWireController } from '@core/features/projects/node/wire-controller';
import { createRepositoryWireController } from '@core/features/repository/node/wire-controller';
import type { SearchService } from '@core/features/search/node/search-service';
import { createSearchWireController } from '@core/features/search/node/wire-controller';
import { createSkillsWireController } from '@core/features/skills/node/wire-controller';
import { createSourceControlWireController } from '@core/features/source-control/node/wire-controller';
import type { TaskService } from '@core/features/tasks/api/node/task-service';
import type { TaskSessionManager } from '@core/features/tasks/api/node/task-session-manager';
import { createTasksWireController } from '@core/features/tasks/node/wire-controller';
import { createTelemetryWireController } from '@core/features/telemetry/node/wire-controller';
import {
  createTerminalsWireController,
  type CreateTerminalsWireControllerOptions,
} from '@core/features/terminals/node/wire-controller';
import {
  createUpdatesWireController,
  type UpdateOperations,
} from '@core/features/updates/node/wire-controller';
import {
  createDesktopHostWireController,
  type DesktopHostControllerOperations,
} from '@core/features/workbench/node/wire-controller';
import type { WorkspacePlacementResolver } from '@core/features/workspaces/api/node/placement/workspace-placement-resolver';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import {
  createProjectSettingsWireController,
  createProjectWorkspacesWireController,
} from '@core/features/workspaces/node/project-wire-controllers';
import {
  createWorkspacesWireController,
  type CreateWorkspacesWireControllerOptions,
} from '@core/features/workspaces/node/wire-controller';
import type { SshServiceHandle } from '@core/manifests/node/ssh-service-handle';
import { desktopDomainContracts } from '@core/manifests/shared/domain-contracts';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb } from '@core/services/app-db/node/db';
import type { NotificationService } from '@core/services/notifications/node';
import { createNotificationsWireController } from '@core/services/notifications/node/wire-controller';
import type { OperationsEngine } from '@core/services/operations/node';
import type { PullRequestsRuntimeClient } from '@core/services/pull-requests/api';
import type { RemoteMachineService } from '@core/services/remote-machine/node';
import { createRemoteMachineWireController } from '@core/services/remote-machine/node/wire-controller';
import type {
  MementosRuntimeClient,
  WorkspaceRuntimeClient,
} from '@core/services/runtime-broker/api/clients';
import type { AppSettingsService } from '@core/services/settings/node';
import type { ProviderOverrideSettings } from '@core/services/settings/node/provider-settings-service';
import {
  createAppSettingsWireController,
  type SettingsRuntimePort,
} from '@core/services/settings/node/wire-controller';
import { createSshWireController } from '@core/services/ssh/node/controller';

export type DesktopControllerContext = {
  readonly accountService: EmdashAccountService;
  readonly agentDependencies: Omit<
    Parameters<typeof createAgentOperations>[0],
    'providerOverrideSettings'
  >;
  readonly appSettings: AppSettingsService;
  readonly automations: AutomationsService;
  readonly browserOperations: BrowserOperations;
  readonly compensation: CompensationRunner;
  readonly db: AppDb;
  readonly editorBuffer: EditorBufferService;
  readonly github: Omit<Parameters<typeof createGithubWireController>[0], 'logger' | 'telemetry'>;
  readonly hostOperations: DesktopHostControllerOperations;
  readonly issueProviders: IssueProviderRegistry;
  readonly legacyPortOperations: LegacyPortControllerOperations;
  readonly logger: Logger;
  readonly notifications: NotificationService;
  readonly operations: OperationsEngine;
  readonly promptLibrary: PromptLibraryService;
  readonly projects: ProjectSessionManager;
  readonly projectSettings: ProjectSettingsService;
  readonly providerSettings: ProviderOverrideSettings;
  readonly remoteMachine: RemoteMachineService;
  readonly runtimeClients: {
    getMementosRuntimeClient(): Promise<MementosRuntimeClient>;
    getPullRequestsRuntimeClient(): Promise<PullRequestsRuntimeClient>;
    getWorkspaceRuntimeClient(): Promise<WorkspaceRuntimeClient>;
  };
  readonly scope: Scope;
  readonly search: SearchService;
  readonly runtimes: RuntimeBroker;
  readonly ssh: SshServiceHandle;
  readonly settingsRuntime: SettingsRuntimePort;
  readonly telemetry: TelemetryService;
  readonly taskService: TaskService;
  readonly taskSessions: TaskSessionManager;
  readonly terminalShell: CreateTerminalsWireControllerOptions['terminalShell'];
  readonly updateOperations: UpdateOperations;
  readonly workspaceIdentity: WorkspaceIdentityService;
  readonly workspacePlacement: WorkspacePlacementResolver;
  readonly workspaces: Omit<
    CreateWorkspacesWireControllerOptions,
    'db' | 'getWorkspaceRuntimeClient' | 'operations' | 'runtimes' | 'workspaceIdentity'
  >;
};

type DesktopDomain = Extract<keyof typeof desktopDomainContracts, string>;

export type DesktopNodeControllerContribution = {
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
    create: ({ accountService, logger, telemetry }) =>
      createAccountWireController(accountService, { logger, telemetry }),
  },
  agents: {
    create: ({ agentDependencies, providerSettings, runtimes }) =>
      createAgentsWireController({
        operations: createAgentOperations({
          ...agentDependencies,
          providerOverrideSettings: providerSettings,
        }),
        runtimes,
      }),
  },
  appSettings: {
    create: ({ appSettings, settingsRuntime }) =>
      createAppSettingsWireController(appSettings, settingsRuntime),
  },
  editor: {
    create: ({ editorBuffer, runtimes, workspaceIdentity }) =>
      createEditorWireController({ editorBuffer, runtimes, workspaceIdentity }),
  },
  legacyPort: {
    create: ({ legacyPortOperations }) => createLegacyPortWireController(legacyPortOperations),
  },
  machines: {
    create: ({ runtimes, ssh }) => createMachinesWireController(ssh.machines, runtimes),
  },
  projectSettings: {
    create: ({ projects, runtimes, workspaceIdentity }) =>
      createProjectSettingsWireController({ projects, runtimes, workspaceIdentity }),
  },
  projectWorkspaces: {
    create: ({ db, operations, runtimes, taskService, taskSessions }) =>
      createProjectWorkspacesWireController({
        db,
        operations,
        runtimes,
        taskService,
        taskSessions,
      }),
  },
  promptLibrary: {
    create: ({ promptLibrary }) => createPromptLibraryWireController(promptLibrary),
  },
  repository: {
    create: ({ projects }) => createRepositoryWireController(projects),
  },
  search: {
    create: ({ search }) => createSearchWireController(search),
  },
  telemetry: {
    create: ({ telemetry }) => createTelemetryWireController(telemetry),
  },
  sourceControl: {
    create: ({ runtimes, workspaceIdentity }) =>
      createSourceControlWireController({ runtimes, workspaceIdentity }),
  },
  mcp: {
    create: ({ runtimes }) => createMcpWireController({ runtimes }),
  },
  skills: {
    create: ({ runtimes }) => createSkillsWireController({ runtimes }),
  },
  terminals: {
    create: ({
      appSettings,
      db,
      logger,
      projects,
      runtimes,
      telemetry,
      terminalShell,
      workspaceIdentity,
    }) =>
      createTerminalsWireController({
        db,
        projects,
        runtimes,
        settings: appSettings,
        logger,
        telemetry,
        terminalShell,
        workspaceIdentity,
      }),
  },
  mementos: {
    create: async ({ runtimeClients }) =>
      forwardController(
        desktopDomainContracts.mementos,
        await runtimeClients.getMementosRuntimeClient()
      ),
  },
  notifications: {
    create: ({ notifications }) => createNotificationsWireController(notifications),
  },
  pullRequests: {
    create: async ({ runtimeClients }) =>
      forwardController(
        desktopDomainContracts.pullRequests,
        await runtimeClients.getPullRequestsRuntimeClient()
      ),
  },
  catalog: {
    create: ({ scope }) =>
      controllerFromImpl(desktopDomainContracts.catalog, createCatalogWireController(), scope),
  },
  workspaces: {
    create: ({ db, operations, runtimeClients, scope, workspaces, runtimes, workspaceIdentity }) =>
      controllerFromImpl(
        desktopDomainContracts.workspaces,
        createWorkspacesWireController({
          ...workspaces,
          db,
          getWorkspaceRuntimeClient: runtimeClients.getWorkspaceRuntimeClient,
          operations,
          runtimes,
          workspaceIdentity,
        }),
        scope
      ),
  },
  projects: {
    create: ({
      db,
      operations,
      projects,
      projectSettings,
      runtimeClients,
      runtimes,
      scope,
      workspacePlacement,
    }) =>
      controllerFromImpl(
        desktopDomainContracts.projects,
        createProjectsWireController({
          db,
          getWorkspaceRuntimeClient: runtimeClients.getWorkspaceRuntimeClient,
          operations,
          placement: workspacePlacement,
          projects,
          projectSettings,
          runtimes,
        }),
        scope
      ),
  },
  automations: {
    create: ({ automations, db, projects, runtimes, taskService }) =>
      createAutomationsWireController({
        db,
        getProjectById: async (projectId) => projects.getProject(projectId)?.project,
        runtime: {
          runtimes,
          getProjectById: async (projectId) => projects.getProject(projectId)?.project,
        },
        service: automations,
        taskService,
      }),
  },
  browser: {
    create: ({ browserOperations }) => createBrowserWireController(browserOperations),
  },
  conversations: {
    create: ({
      compensation,
      db,
      logger,
      projects,
      providerSettings,
      runtimes,
      taskSessions,
      telemetry,
      workspaceIdentity,
    }) =>
      createConversationsWireController({
        db,
        logger,
        projects,
        getProviderEnv: async (providerId) => (await providerSettings.getItem(providerId))?.env,
        runtimes,
        taskSessions,
        telemetry,
        workspaceIdentity,
        withCompensation: compensation,
      }),
  },
  previewServers: {
    create: () => createPreviewServersWireController(),
  },
  github: {
    create: ({ github, logger, telemetry }) =>
      createGithubWireController({ ...github, logger, telemetry }),
  },
  integrations: {
    create: () => createIntegrationsWireController(),
  },
  issues: {
    create: ({ issueProviders, projects }) =>
      createIssuesWireController({ projects, providers: issueProviders }),
  },
  ssh: {
    create: ({ ssh }) => createSshWireController(ssh.ssh, ssh.connections),
  },
  remoteMachine: {
    create: ({ remoteMachine }) => createRemoteMachineWireController(remoteMachine),
  },
  tasks: {
    create: ({ db, operations, runtimes, scope, taskService, telemetry, workspaceIdentity }) =>
      controllerFromImpl(
        desktopDomainContracts.tasks,
        createTasksWireController({
          db,
          operations,
          runtimes,
          service: taskService,
          telemetry,
          workspaceIdentity,
        }),
        scope
      ),
  },
  updates: {
    create: ({ updateOperations }) => createUpdatesWireController(updateOperations),
  },
  host: {
    create: ({ hostOperations }) => createDesktopHostWireController(hostOperations),
  },
} satisfies {
  readonly [Domain in DesktopDomain]: DesktopNodeControllerContribution;
};
