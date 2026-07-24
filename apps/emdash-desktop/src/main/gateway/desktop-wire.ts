import { compose } from '@emdash/shared/requests';
import { exposeWireToWindows, validation, type Controller } from '@emdash/wire/api';
import { ipcMain, MessageChannelMain } from 'electron';
import { desktopWireContract } from '@core/manifests/shared/desktop-wire-contract';
import { DESKTOP_WIRE_CHANNEL } from '@core/manifests/shared/wire-channels';
import type { ControllersBundle } from '@main/bootstrap/boot/phases/controllers';
import { appScope } from '@main/bootstrap/core/app-scope';

const scope = appScope.child('desktop-wire');
let installed = false;

export function installDesktopWire(bundle: ControllersBundle): void {
  if (installed || typeof ipcMain?.handle !== 'function') return;
  installed = true;

  scope.add(
    exposeWireToWindows(
      { ipcMain, createMessageChannel },
      compose(createRoutingController(bundle.controllers), [
        validation(desktopWireContract, runtimeWireValidationPolicy()),
      ]),
      { channel: DESKTOP_WIRE_CHANNEL }
    )
  );
  scope.add(() => bundle.scope.dispose());
}

function createMessageChannel() {
  const channel = new MessageChannelMain();
  return { port1: channel.port1, port2: channel.port2 };
}

function createRoutingController(controllers: Record<string, Controller>): Controller {
  return {
    async call(path, input, meta) {
      const routed = route(path, controllers);
      return await routed.controller.call(routed.path, input, meta);
    },
    resolveLive(topic) {
      const routed = route(topic, controllers);
      return routed.controller.resolveLive(routed.path);
    },
    acquireLive(topic) {
      const routed = route(topic, controllers);
      return routed.controller.acquireLive(routed.path);
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
