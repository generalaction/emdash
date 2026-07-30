import { commandRegistry } from '@renderer/lib/commands/registry';
import { events } from '@renderer/lib/ipc';
import { menuReloadChannel } from '@shared/events/appEvents';

export function reloadActiveBrowserOrApp(): void {
  const browserReload = commandRegistry.findById('task.browserReload');
  if (browserReload && browserReload.enabled !== false) {
    browserReload.execute();
    return;
  }
  window.location.reload();
}

export function wireMenuReload(): () => void {
  return events.on(menuReloadChannel, reloadActiveBrowserOrApp);
}
