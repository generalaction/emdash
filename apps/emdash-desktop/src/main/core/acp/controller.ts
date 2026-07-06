import { getMainWindow } from '@main/app/window';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { acpRuntimeProcessHost } from './runtime-process/host';

function requestRuntimePort(): string {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) {
    throw new Error('Main window is not available');
  }
  return acpRuntimeProcessHost.requestRuntimePort(win.webContents);
}

export const acpController = createRPCController({
  requestRuntimePort,
});
