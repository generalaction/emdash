import { ipcMain, BrowserWindow } from 'electron';
import { log } from '../lib/logger';
import {
  workspaceProviderService,
  type ProvisionConfig,
} from '../services/WorkspaceProviderService';

const WORKSPACE_CHANNELS = {
  PROVISION: 'workspace:provision',
  CANCEL: 'workspace:cancel',
  PROVISION_KEEP_WAITING: 'workspace:provision-keep-waiting',
  TERMINATE: 'workspace:terminate',
  STATUS: 'workspace:status',
  PROVISION_PROGRESS: 'workspace:provision-progress',
  PROVISION_COMPLETE: 'workspace:provision-complete',
  PROVISION_TIMEOUT_WARNING: 'workspace:provision-timeout-warning',
} as const;

/**
 * Registers IPC handlers for workspace provisioning.
 *
 * The provision flow is event-based:
 * - `workspace:provision` returns immediately with { success, instanceId }
 * - Progress events are pushed to the renderer via `workspace:provision-progress`
 * - Completion is signalled via `workspace:provision-complete`
 */
export function registerWorkspaceIpc() {
  // Forward service events to the renderer via IPC.
  workspaceProviderService.on(
    'provision-progress',
    (data: { instanceId: string; line: string }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(WORKSPACE_CHANNELS.PROVISION_PROGRESS, data);
      }
    }
  );

  workspaceProviderService.on(
    'provision-complete',
    (data: { instanceId: string; status: string; error?: string }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(WORKSPACE_CHANNELS.PROVISION_COMPLETE, data);
      }
    }
  );

  workspaceProviderService.on('provision-timeout-warning', (data: { instanceId: string }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(WORKSPACE_CHANNELS.PROVISION_TIMEOUT_WARNING, data);
    }
  });

  // ── workspace:provision ──────────────────────────────────────────────
  ipcMain.handle(
    WORKSPACE_CHANNELS.PROVISION,
    async (
      _,
      args: {
        taskId: string;
        repoUrl: string;
        branch: string;
        baseRef: string;
        provisionCommand: string;
        projectPath: string;
      }
    ) => {
      try {
        const config: ProvisionConfig = {
          taskId: args.taskId,
          repoUrl: args.repoUrl,
          branch: args.branch,
          baseRef: args.baseRef,
          provisionCommand: args.provisionCommand,
          projectPath: args.projectPath,
        };
        const instanceId = await workspaceProviderService.provision(config);
        return { success: true, data: { instanceId } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('[workspaceIpc] provision failed', { error: message });
        return { success: false, error: message };
      }
    }
  );

  // ── workspace:cancel ─────────────────────────────────────────────────
  ipcMain.handle(WORKSPACE_CHANNELS.CANCEL, async (_, args: { instanceId: string }) => {
    try {
      await workspaceProviderService.cancel(args.instanceId);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('[workspaceIpc] cancel failed', { error: message });
      return { success: false, error: message };
    }
  });

  // ── workspace:provision-keep-waiting ─────────────────────────────────
  ipcMain.handle(
    WORKSPACE_CHANNELS.PROVISION_KEEP_WAITING,
    async (_, args: { instanceId: string }) => {
      workspaceProviderService.onProvisionTimeoutChoice(args.instanceId, 'keep');
      return { success: true };
    }
  );

  // ── workspace:terminate ──────────────────────────────────────────────
  ipcMain.handle(
    WORKSPACE_CHANNELS.TERMINATE,
    async (
      _,
      args: {
        instanceId: string;
        terminateCommand: string;
        projectPath: string;
        env?: Record<string, string>;
      }
    ) => {
      try {
        await workspaceProviderService.terminate({
          instanceId: args.instanceId,
          terminateCommand: args.terminateCommand,
          projectPath: args.projectPath,
          env: args.env,
        });
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('[workspaceIpc] terminate failed', { error: message });
        return { success: false, error: message };
      }
    }
  );

  // ── workspace:status ─────────────────────────────────────────────────
  ipcMain.handle(WORKSPACE_CHANNELS.STATUS, async (_, args: { taskId: string }) => {
    try {
      const instance = await workspaceProviderService.getActiveInstance(args.taskId);
      if (!instance) return { success: true, data: null };
      const awaitingTimeoutChoice =
        instance.status === 'provisioning' &&
        workspaceProviderService.isAwaitingTimeoutChoice(instance.id);
      return {
        success: true,
        data: { ...instance, awaitingTimeoutChoice },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('[workspaceIpc] status failed', { error: message });
      return { success: false, error: message };
    }
  });
}
