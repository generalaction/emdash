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
import type { EmdashAccountService } from '@core/features/account/node/services/emdash-account-service';
import { createAccountWireController } from '@core/features/account/node/wire-controller';
import { createAgentsWireController } from '@core/features/agents/node/wire-controller';
import { createAutomationsWireController } from '@core/features/automations/node/wire-controller';
import { createBrowserWireController } from '@core/features/browser/node/wire-controller';
import { createConversationsWireController } from '@core/features/conversations/node/wire-controller';
import type { EditorBufferService } from '@core/features/editor/node/editor-buffer-service';
import { createEditorWireController } from '@core/features/editor/node/wire-controller';
import { createGithubWireController } from '@core/features/github/node/wire-controller';
import { createIntegrationsWireController } from '@core/features/integrations/node/wire-controller';
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
import { createProjectsWireController } from '@core/features/projects/node/wire-controller';
import { createRepositoryWireController } from '@core/features/repository/node/wire-controller';
import type { SearchService } from '@core/features/search/node/search-service';
import { createSearchWireController } from '@core/features/search/node/wire-controller';
import { createSkillsWireController } from '@core/features/skills/node/wire-controller';
import { createSourceControlWireController } from '@core/features/source-control/node/wire-controller';
import { createTasksWireController } from '@core/features/tasks/node/wire-controller';
import { createTelemetryWireController } from '@core/features/telemetry/node/wire-controller';
import { createTerminalsWireController } from '@core/features/terminals/node/wire-controller';
import { createUpdatesWireController } from '@core/features/updates/node/wire-controller';
import { createDesktopHostWireController } from '@core/features/workbench/node/wire-controller';
import {
  createProjectSettingsWireController,
  createProjectWorkspacesWireController,
} from '@core/features/workspaces/node/project-wire-controllers';
import {
  createWorkspacesWireController,
  type CreateWorkspacesWireControllerOptions,
} from '@core/features/workspaces/node/wire-controller';
import type { WorkspaceIdentityService } from '@core/features/workspaces/node/workspace-identity-service';
import { desktopDomainContracts } from '@core/manifests/shared/domain-contracts';
import type { AppDb } from '@core/services/app-db/node/db';
import { createCatalogWireController } from '@core/services/catalog/node/wire-controller';
import type { NotificationService } from '@core/services/notifications/node';
import { createNotificationsWireController } from '@core/services/notifications/node/wire-controller';
import type { AppSettingsService } from '@core/services/settings/node';
import type { ProviderOverrideSettings } from '@core/services/settings/node/provider-settings-service';
import { createAppSettingsWireController } from '@core/services/settings/node/wire-controller';
import type { SshServiceHandle } from '@core/services/ssh/node';
import { createSshWireController } from '@core/services/ssh/node/wire-controller';
import { createAgentOperations } from '@main/core/agents/controller';
import {
  getMementosRuntimeClient,
  getPullRequestsRuntimeClient,
} from '@main/gateway/desktop-workers';

export type DesktopControllerContext = {
  readonly accountService: EmdashAccountService;
  readonly appSettings: AppSettingsService;
  readonly db: AppDb;
  readonly editorBuffer: EditorBufferService;
  readonly legacyPortOperations: LegacyPortControllerOperations;
  readonly notifications: NotificationService;
  readonly promptLibrary: PromptLibraryService;
  readonly providerSettings: ProviderOverrideSettings;
  readonly scope: Scope;
  readonly search: SearchService;
  readonly runtimes: RuntimeBroker;
  readonly ssh: SshServiceHandle;
  readonly workspaceIdentity: WorkspaceIdentityService;
  readonly workspaces: Omit<
    CreateWorkspacesWireControllerOptions,
    'db' | 'runtimes' | 'workspaceIdentity'
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
    create: ({ accountService }) => createAccountWireController(accountService),
  },
  agents: {
    create: ({ providerSettings, runtimes }) =>
      createAgentsWireController({
        operations: createAgentOperations(providerSettings),
        runtimes,
      }),
  },
  appSettings: {
    create: ({ appSettings }) => createAppSettingsWireController(appSettings),
  },
  editor: {
    create: ({ editorBuffer, runtimes, workspaceIdentity }) =>
      createEditorWireController({ editorBuffer, runtimes, workspaceIdentity }),
  },
  legacyPort: {
    create: ({ legacyPortOperations }) => createLegacyPortWireController(legacyPortOperations),
  },
  machines: {
    create: ({ ssh }) => createMachinesWireController(ssh.machines),
  },
  projectSettings: {
    create: () => createProjectSettingsWireController(),
  },
  projectWorkspaces: {
    create: () => createProjectWorkspacesWireController(),
  },
  promptLibrary: {
    create: ({ promptLibrary }) => createPromptLibraryWireController(promptLibrary),
  },
  repository: {
    create: () => createRepositoryWireController(),
  },
  search: {
    create: ({ search }) => createSearchWireController(search),
  },
  telemetry: {
    create: () => createTelemetryWireController(),
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
    create: ({ appSettings, db, runtimes, workspaceIdentity }) =>
      createTerminalsWireController({
        db,
        runtimes,
        settings: appSettings,
        workspaceIdentity,
      }),
  },
  mementos: {
    create: async () =>
      forwardController(desktopDomainContracts.mementos, await getMementosRuntimeClient()),
  },
  notifications: {
    create: ({ notifications }) => createNotificationsWireController(notifications),
  },
  pullRequests: {
    create: async () =>
      forwardController(desktopDomainContracts.pullRequests, await getPullRequestsRuntimeClient()),
  },
  catalog: {
    create: ({ scope }) =>
      controllerFromImpl(desktopDomainContracts.catalog, createCatalogWireController(), scope),
  },
  workspaces: {
    create: ({ db, scope, workspaces, runtimes, workspaceIdentity }) =>
      controllerFromImpl(
        desktopDomainContracts.workspaces,
        createWorkspacesWireController({ ...workspaces, db, runtimes, workspaceIdentity }),
        scope
      ),
  },
  projects: {
    create: ({ scope }) =>
      controllerFromImpl(desktopDomainContracts.projects, createProjectsWireController(), scope),
  },
  automations: {
    create: () => createAutomationsWireController(),
  },
  browser: {
    create: () => createBrowserWireController(),
  },
  conversations: {
    create: ({ db, runtimes, workspaceIdentity }) =>
      createConversationsWireController({ db, runtimes, workspaceIdentity }),
  },
  previewServers: {
    create: () => createPreviewServersWireController(),
  },
  github: {
    create: () => createGithubWireController(),
  },
  integrations: {
    create: () => createIntegrationsWireController(),
  },
  issues: {
    create: () => createIssuesWireController(),
  },
  ssh: {
    create: ({ ssh }) => createSshWireController(ssh.ssh, ssh.connections),
  },
  tasks: {
    create: ({ scope }) =>
      controllerFromImpl(desktopDomainContracts.tasks, createTasksWireController(), scope),
  },
  updates: {
    create: () => createUpdatesWireController(),
  },
  host: {
    create: () => createDesktopHostWireController(),
  },
} satisfies {
  readonly [Domain in DesktopDomain]: DesktopNodeControllerContribution;
};
