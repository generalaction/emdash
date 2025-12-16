import { ipcMain, BrowserWindow } from 'electron';
import { log } from '../lib/logger';
import { worktreeRunService } from '../services/WorktreeRunService';
import type { ResolvedRunConfig } from '../../shared/worktreeRun/config';
import fs from 'fs';
import path from 'path';

const PROJECT_CONFIG_PATH = '.emdash/config.json';

export function registerWorktreeRunIpc() {
  /**
   * Start a worktree run
   */
  ipcMain.handle(
    'worktreeRun:start',
    async (
      _event,
      args: {
        workspaceId: string;
        worktreePath: string;
        projectPath: string;
        scriptName?: string;
        preferredProvider?: string;
      }
    ) => {
      try {
        const { workspaceId, worktreePath, projectPath, scriptName, preferredProvider } = args;
        const result = await worktreeRunService.start(workspaceId, worktreePath, projectPath, {
          scriptName,
          preferredProvider,
        });
        return result;
      } catch (error) {
        log.error('IPC worktreeRun:start failed', { error });
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  /**
   * Stop a worktree run
   */
  ipcMain.handle('worktreeRun:stop', async (_event, args: { workspaceId: string }) => {
    try {
      const { workspaceId } = args;
      const result = worktreeRunService.stop(workspaceId);
      return result;
    } catch (error) {
      log.error('IPC worktreeRun:stop failed', { error });
      return { ok: false };
    }
  });

  /**
   * Get run state for a worktree
   */
  ipcMain.handle('worktreeRun:getState', async (_event, args: { workspaceId: string }) => {
    try {
      const { workspaceId } = args;
      const state = worktreeRunService.getState(workspaceId);
      return { ok: true, state };
    } catch (error) {
      log.error('IPC worktreeRun:getState failed', { error });
      return { ok: false, state: null };
    }
  });

  /**
   * Load config for editing
   */
  ipcMain.handle('worktreeRun:loadConfig', async (_event, args: { projectPath: string }) => {
    try {
      const { projectPath } = args;
      const configPath = path.join(projectPath, PROJECT_CONFIG_PATH);

      if (!fs.existsSync(configPath)) {
        return { ok: true, config: null, exists: false };
      }

      const raw = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(raw);
      return { ok: true, config, exists: true };
    } catch (error) {
      log.error('IPC worktreeRun:loadConfig failed', { error });
      return {
        ok: false,
        config: null,
        exists: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /**
   * Save config
   */
  ipcMain.handle(
    'worktreeRun:saveConfig',
    async (_event, args: { projectPath: string; config: ResolvedRunConfig }) => {
      try {
        const { projectPath, config } = args;
        const configPath = path.join(projectPath, PROJECT_CONFIG_PATH);
        const configDir = path.dirname(configPath);

        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        log.info('Saved run config', { configPath });
        return { ok: true };
      } catch (error) {
        log.error('IPC worktreeRun:saveConfig failed', { error });
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // Forward events from WorktreeRunService to all renderer windows
  worktreeRunService.onEvent((event) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('worktreeRun:event', event);
    });
  });
}
