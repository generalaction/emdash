import { ipcMain, BrowserWindow } from 'electron';
import { log } from '../lib/logger';
import { worktreeRunService } from '../services/WorktreeRunService';
import { projectRunConfigService } from '../services/ProjectRunConfigService';
import { setupStepsService, type SetupStepsEvent } from '../services/SetupStepsService';
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
   * Run setup steps (dependency installs, etc) in a worktree before starting scripts.
   */
  ipcMain.handle(
    'worktreeRun:setupStepsStart',
    async (
      _event,
      args: { workspaceId: string; worktreePath: string; steps: string[] }
    ) => {
      try {
        const { workspaceId, worktreePath, steps } = args;
        return await setupStepsService.run({ workspaceId, worktreePath, steps });
      } catch (error) {
        log.error('IPC worktreeRun:setupStepsStart failed', { error });
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  /**
   * Cancel running setup steps.
   */
  ipcMain.handle('worktreeRun:setupStepsCancel', async (_event, args: { workspaceId: string }) => {
    try {
      const { workspaceId } = args;
      return setupStepsService.cancel(workspaceId);
    } catch (error) {
      log.error('IPC worktreeRun:setupStepsCancel failed', { error });
      return { ok: false };
    }
  });

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

  /**
   * Delete config
   */
  ipcMain.handle('worktreeRun:deleteConfig', async (_event, args: { projectPath: string }) => {
    try {
      const { projectPath } = args;
      const configPath = path.join(projectPath, PROJECT_CONFIG_PATH);

      if (!fs.existsSync(configPath)) {
        return { ok: true, deleted: false, message: 'Config does not exist' };
      }

      fs.unlinkSync(configPath);
      log.info('Deleted run config', { configPath });
      return { ok: true, deleted: true };
    } catch (error) {
      log.error('IPC worktreeRun:deleteConfig failed', { error });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /**
   * Regenerate config via AI
   */
  ipcMain.handle(
    'worktreeRun:regenerateConfig',
    async (
      _event,
      args: { projectPath: string; preferredProvider?: string }
    ) => {
      try {
        const { projectPath, preferredProvider } = args;
        const { runConfigGenerationService } = await import('../services/RunConfigGenerationService');

        log.info('Regenerating config via AI', { projectPath, preferredProvider });
        const generated = await runConfigGenerationService.generateRunConfig(
          projectPath,
          preferredProvider
        );

        if (!generated) {
          return {
            ok: false,
            error: 'AI generation failed. Please check that your CLI coding agent is available and configured.',
          };
        }

        // Save generated config
        const configPath = path.join(projectPath, PROJECT_CONFIG_PATH);
        const configDir = path.dirname(configPath);

        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
        }

        fs.writeFileSync(configPath, JSON.stringify(generated.config, null, 2), 'utf8');
        log.info('Saved regenerated config', { configPath });

        return {
          ok: true,
          config: generated.config,
          reasoning: generated.reasoning,
        };
      } catch (error) {
        log.error('IPC worktreeRun:regenerateConfig failed', { error });
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  /**
   * Get project-level run config generation status
   */
  ipcMain.handle(
    'worktreeRun:getProjectConfigStatus',
    async (
      _event,
      args: {
        projectId: string;
        projectPath: string;
      }
    ) => {
      try {
        const { projectId, projectPath } = args;
        const state = projectRunConfigService.getStatus(projectId, projectPath);
        return { ok: true, state };
      } catch (error) {
        log.error('IPC worktreeRun:getProjectConfigStatus failed', { error });
        return { ok: false, state: null, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  /**
   * Ensure project-level `.emdash/config.json` exists (generate if missing).
   * Respects last failure unless `force: true`.
   */
  ipcMain.handle(
    'worktreeRun:ensureProjectConfig',
    async (
      _event,
      args: {
        projectId: string;
        projectPath: string;
        preferredProvider?: string;
        force?: boolean;
      }
    ) => {
      try {
        const state = await projectRunConfigService.ensureProjectConfig(args);
        return { ok: true, state };
      } catch (error) {
        log.error('IPC worktreeRun:ensureProjectConfig failed', { error });
        return { ok: false, state: null, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  // Forward events from WorktreeRunService to all renderer windows
  worktreeRunService.onEvent((event) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('worktreeRun:event', event);
    });
  });

  // Forward setup steps events to all renderer windows
  setupStepsService.onEvent((event: SetupStepsEvent) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('worktreeRun:setupStepsEvent', event);
    });
  });

  // Forward events from ProjectRunConfigService to all renderer windows
  projectRunConfigService.on('event', (event: any) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('worktreeRun:event', event);
    });
  });
}
