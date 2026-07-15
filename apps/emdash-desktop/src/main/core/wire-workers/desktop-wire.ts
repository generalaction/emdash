import { acpApiContract } from '@emdash/core/runtimes/acp/api';
import { agentConfigContract } from '@emdash/core/runtimes/agent-config/api';
import { filesContract } from '@emdash/core/runtimes/files/api';
import { gitContract } from '@emdash/core/runtimes/git/api';
import { terminalsContract } from '@emdash/core/runtimes/terminals/api';
import { tuiAgentsContract } from '@emdash/core/runtimes/tui-agents/api';
import {
  createController,
  exposeWireToWindows,
  forwardController,
  validation,
  type Controller,
} from '@emdash/wire/api';
import { compose } from '@emdash/wire/util';
import { notificationService } from '@services/notifications/node';
import { createNotificationsWireController } from '@services/notifications/node/wire-controller';
import { ipcMain, MessageChannelMain } from 'electron';
import { appScope } from '@main/app/app-scope';
import { createCatalogWireController } from '@main/core/catalog/wire-controller';
import { createDevServerBridge } from '@main/core/preview-servers/dev-server-bridge';
import { createProjectsWireController } from '@main/core/projects/wire-controller';
import { createTerminalTabsWireController } from '@main/core/terminals/wire-controller';
import {
  getAcpRuntimeClient,
  getAgentConfigRuntimeClient,
  getFilesRuntimeClient,
  getGitRuntimeClient,
  getTerminalsRuntimeClient,
  getTuiAgentsRuntimeClient,
} from '@main/core/wire-workers/desktop-workers';
import {
  createWorkspacesWireController,
  type CreateWorkspacesWireControllerOptions,
} from '@main/core/workspaces/wire-controller';
import { catalogWireContract } from '@shared/core/catalog/wire-contract';
import { projectsWireContract } from '@shared/core/projects/wire-contract';
import { desktopWireContract } from '@shared/core/runtime/desktop-wire-contract';
import { DESKTOP_WIRE_CHANNEL } from '@shared/core/runtime/wire-channels';
import { terminalTabsWireContract } from '@shared/core/terminals/wire-contract';
import { workspacesWireContract } from '@shared/core/workspaces/wire-contract';

export type InstallDesktopWireOptions = CreateWorkspacesWireControllerOptions;

const scope = appScope.child('desktop-wire');
let installed = false;

export function installDesktopWire(options: InstallDesktopWireOptions): void {
  if (installed || typeof ipcMain?.handle !== 'function') return;
  installed = true;

  const workspacesController = createWorkspacesWireController(options);
  const projectsController = createProjectsWireController();
  const terminalTabsController = createTerminalTabsWireController();
  const catalogController = createCatalogWireController();
  const controller = createLazyDesktopController({
    workspacesController,
    projectsController,
    terminalTabsController,
    catalogController,
  });

  scope.add(
    exposeWireToWindows(
      { ipcMain, createMessageChannel },
      compose(controller, [validation(desktopWireContract, runtimeWireValidationPolicy())]),
      { channel: DESKTOP_WIRE_CHANNEL, beforeOpen: () => controller.ready() }
    )
  );
  scope.add(() => controller.dispose());
}

function createMessageChannel() {
  const channel = new MessageChannelMain();
  return { port1: channel.port1, port2: channel.port2 };
}

function createLazyDesktopController({
  workspacesController,
  projectsController,
  terminalTabsController,
  catalogController,
}: {
  workspacesController: ReturnType<typeof createWorkspacesWireController>;
  projectsController: ReturnType<typeof createProjectsWireController>;
  terminalTabsController: ReturnType<typeof createTerminalTabsWireController>;
  catalogController: ReturnType<typeof createCatalogWireController>;
}): Controller & { ready(): Promise<void>; dispose(): Promise<void> } {
  let controllers: Record<string, Controller> | undefined;
  let devServerBridge: Awaited<ReturnType<typeof createDevServerBridge>> | undefined;

  async function ready(): Promise<void> {
    if (controllers) return;
    const [acp, agentConfig, files, git, terminals, tuiAgents] = await Promise.all([
      getAcpRuntimeClient(),
      getAgentConfigRuntimeClient(),
      getFilesRuntimeClient(),
      getGitRuntimeClient(),
      getTerminalsRuntimeClient(),
      getTuiAgentsRuntimeClient(),
    ]);
    devServerBridge = await createDevServerBridge(terminals);
    controllers = {
      git: forwardController(gitContract, git),
      files: forwardController(filesContract, files),
      acp: forwardController(acpApiContract, acp),
      agentConfig: forwardController(agentConfigContract, agentConfig),
      terminals: forwardController(terminalsContract, terminals),
      terminalTabs: createController(terminalTabsWireContract, terminalTabsController.impl),
      tuiAgents: forwardController(tuiAgentsContract, tuiAgents),
      notifications: createNotificationsWireController(notificationService),
      catalog: createController(catalogWireContract, catalogController.impl),
      workspaces: createController(workspacesWireContract, workspacesController.impl),
      projects: createController(projectsWireContract, projectsController.impl),
    };
  }

  return {
    ready,
    async call(path, input, meta) {
      await ready();
      const routed = route(path, controllers!);
      return await routed.controller.call(routed.path, input, meta);
    },
    resolveLive(topic) {
      if (!controllers) throw new Error('Desktop wire controller is not ready');
      const routed = route(topic, controllers);
      return routed.controller.resolveLive(routed.path);
    },
    acquireLive(topic) {
      if (!controllers) throw new Error('Desktop wire controller is not ready');
      const routed = route(topic, controllers);
      return routed.controller.acquireLive(routed.path);
    },
    async dispose() {
      await Promise.all(
        Object.values(controllers ?? {}).map(async (controller) => {
          await controller.dispose?.();
        })
      );
      await projectsController.dispose();
      await workspacesController.dispose();
      await terminalTabsController.dispose();
      await catalogController.dispose();
      await devServerBridge?.dispose();
    },
  };
}

function route(path: string, controllers: Record<string, Controller>) {
  const [prefix, ...rest] = path.split('.');
  const controller = controllers[prefix];
  if (!controller || rest.length === 0) {
    throw new Error(`Unknown desktop wire path '${path}'`);
  }
  return { controller, path: rest.join('.') };
}

function runtimeWireValidationPolicy() {
  return import.meta.env.DEV ? 'full' : 'inputs';
}
