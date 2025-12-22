import { ipcMain } from 'electron';
import { acpService } from '../services/AcpService';

export function registerAcpIpc() {
  ipcMain.handle('acp:start', async (_event, args: { taskId: string; providerId: string; cwd: string }) => {
    return acpService.startSession(args);
  });

  ipcMain.handle(
    'acp:prompt',
    async (_event, args: { sessionId: string; prompt: Array<{ type: string; [key: string]: any }> }) => {
      return acpService.sendPrompt(args);
    }
  );

  ipcMain.handle('acp:cancel', async (_event, args: { sessionId: string }) => {
    acpService.cancelSession(args.sessionId);
    return { success: true };
  });

  ipcMain.handle('acp:dispose', async (_event, args: { sessionId: string }) => {
    acpService.disposeSession(args.sessionId);
    return { success: true };
  });

  ipcMain.handle(
    'acp:permission',
    async (
      _event,
      args: {
        sessionId: string;
        requestId: number;
        outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' };
      }
    ) => {
      return acpService.respondPermission(args);
    }
  );

  ipcMain.handle('acp:set-mode', async (_event, args: { sessionId: string; modeId: string }) => {
    return acpService.setMode(args.sessionId, args.modeId);
  });
}
