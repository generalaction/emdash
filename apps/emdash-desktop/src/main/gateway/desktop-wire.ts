import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { compose } from '@emdash/shared/requests';
import { exposeWireToWindows, validation, type Controller } from '@emdash/wire/api';
import { ipcMain, MessageChannelMain } from 'electron';
import {
  desktopNodeControllers,
  type DesktopControllerContext,
} from '@core/manifests/node/controllers';
import type { SshServiceHandle } from '@core/manifests/node/ssh-service-handle';
import { desktopWireContract } from '@core/manifests/shared/desktop-wire-contract';
import { desktopDomainContracts } from '@core/manifests/shared/domain-contracts';
import { DESKTOP_WIRE_CHANNEL } from '@core/manifests/shared/wire-channels';
import type { WorkspaceServerServiceHandle } from '@core/services/workspace-server/node';
import { appScope } from '@main/bootstrap/core/app-scope';
import { createRetryableReady } from './retryable-ready';
import { getDesktopRuntimeBroker } from './runtime-broker';

export type InstallDesktopWireOptions = Omit<
  DesktopControllerContext,
  'runtimes' | 'scope' | 'ssh' | 'workspaceServer'
>;

const scope = appScope.child('desktop-wire');
let installed = false;

export function installDesktopWire(
  options: InstallDesktopWireOptions,
  ssh: SshServiceHandle,
  workspaceServer: WorkspaceServerServiceHandle
): void {
  if (installed || typeof ipcMain?.handle !== 'function') return;
  installed = true;

  const runtimes = getDesktopRuntimeBroker();
  const controller = createLazyDesktopController(options, runtimes, ssh, workspaceServer);

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

function createLazyDesktopController(
  options: InstallDesktopWireOptions,
  runtimes: RuntimeBroker,
  ssh: SshServiceHandle,
  workspaceServer: WorkspaceServerServiceHandle
): Controller & { ready(): Promise<void>; dispose(): Promise<void> } {
  let controllers: Record<string, Controller> | undefined;
  let controllerScopes: ReturnType<typeof scope.child>[] = [];
  let disposePromise: Promise<void> | undefined;

  const ready = createRetryableReady(async () => {
    const pendingScopes: ReturnType<typeof scope.child>[] = [];
    try {
      if (import.meta.env.DEV) assertDomainKeyParity();
      const entries = await Promise.all(
        Object.entries(desktopNodeControllers).map(async ([domain, contribution]) => {
          const controllerScope = scope.child(`controller:${domain}`);
          pendingScopes.push(controllerScope);
          const controller = await contribution.create({
            ...options,
            scope: controllerScope,
            runtimes,
            ssh,
            workspaceServer,
          });
          return [domain, controller] as const;
        })
      );
      controllerScopes = pendingScopes;
      controllers = Object.fromEntries(entries);
    } catch (error) {
      await Promise.all(pendingScopes.map((controllerScope) => controllerScope.dispose(error)));
      throw error;
    }
  });

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
      disposePromise ??= (async () => {
        await Promise.all(
          Object.values(controllers ?? {}).map(async (controller) => {
            await controller.dispose?.();
          })
        );
        await Promise.all(controllerScopes.map((controllerScope) => controllerScope.dispose()));
        controllers = undefined;
        controllerScopes = [];
      })();
      return disposePromise;
    },
  };
}

function assertDomainKeyParity(): void {
  const contractDomains = Object.keys(desktopDomainContracts).sort();
  const controllerDomains = Object.keys(desktopNodeControllers).sort();
  if (
    contractDomains.length === controllerDomains.length &&
    contractDomains.every((domain, index) => domain === controllerDomains[index])
  ) {
    return;
  }

  const contractSet = new Set(contractDomains);
  const controllerSet = new Set(controllerDomains);
  const missingControllers = contractDomains.filter((domain) => !controllerSet.has(domain));
  const unknownControllers = controllerDomains.filter((domain) => !contractSet.has(domain));
  throw new Error(
    `Desktop Wire domain mismatch: missing controllers [${missingControllers.join(
      ', '
    )}], unknown controllers [${unknownControllers.join(', ')}]`
  );
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
