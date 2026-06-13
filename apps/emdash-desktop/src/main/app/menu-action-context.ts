import { app, clipboard, shell } from 'electron';
import { getMainWindow } from '@main/app/window';
import { events } from '@main/lib/events';
import { telemetryService } from '@main/lib/telemetry';
import type { CompactMenuActionId } from '@shared/app-menu';
import {
  executeCompactMenuAction,
  type CompactMenuActionContext,
  type CompactMenuWindow,
} from './menu-actions';

export async function performCompactMenuAction(actionId: CompactMenuActionId): Promise<void> {
  await executeCompactMenuAction(actionId, createDefaultCompactMenuActionContext());
}

function createDefaultCompactMenuActionContext(): CompactMenuActionContext {
  return {
    getWindow: () => getMainWindow() as CompactMenuWindow | null,
    emit: (event, data) => events.emit(event, data),
    openExternal: (url) => shell.openExternal(url),
    copyInstallationId,
    quitImmediately: () => app.quit(),
  };
}

function copyInstallationId(): void {
  const instanceId = telemetryService.getInstanceId() ?? 'unavailable';
  const lines = [
    `Emdash ${app.getVersion()}`,
    `Installation ID: ${instanceId}`,
    `Platform: ${process.platform} ${process.arch}`,
    `Electron: ${process.versions.electron}`,
  ];
  clipboard.writeText(lines.join('\n'));
}
