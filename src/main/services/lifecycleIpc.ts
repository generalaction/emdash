import { BrowserWindow, ipcMain } from 'electron';
import { lifecycleScriptsService } from './LifecycleScriptsService';
import { log } from '../lib/logger';
import { LIFECYCLE_EVENT_CHANNEL, LIFECYCLE_PHASES } from '@shared/lifecycle';
import { taskLifecycleService } from './TaskLifecycleService';

export function registerLifecycleIpc(): void {
  // Get a specific lifecycle phase script for a project
  ipcMain.handle(
    'lifecycle:getScript',
    async (
      _event,
      args: {
        projectPath: string;
        phase: string;
      }
    ) => {
      try {
        if (!LIFECYCLE_PHASES.includes(args.phase as (typeof LIFECYCLE_PHASES)[number])) {
          return { success: false, error: `Invalid lifecycle phase: ${args.phase}` };
        }
        const phase = args.phase as (typeof LIFECYCLE_PHASES)[number];
        const script = lifecycleScriptsService.getScript(args.projectPath, phase);
        return { success: true, script };
      } catch (error) {
        log.error('Failed to get lifecycle script:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle(
    'lifecycle:setup',
    async (
      _event,
      args: {
        taskId: string;
        taskPath: string;
        projectPath: string;
      }
    ) => {
      try {
        const result = await taskLifecycleService.runSetup(args.taskId, args.taskPath, args.projectPath);
        return { success: result.ok, ...result };
      } catch (error) {
        log.error('Failed to run setup lifecycle phase:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle(
    'lifecycle:run:start',
    async (
      _event,
      args: {
        taskId: string;
        taskPath: string;
        projectPath: string;
      }
    ) => {
      try {
        const result = await taskLifecycleService.startRun(args.taskId, args.taskPath, args.projectPath);
        return { success: result.ok, ...result };
      } catch (error) {
        log.error('Failed to start run lifecycle phase:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle('lifecycle:run:stop', async (_event, args: { taskId: string }) => {
    try {
      const result = taskLifecycleService.stopRun(args.taskId);
      return { success: result.ok, ...result };
    } catch (error) {
      log.error('Failed to stop run lifecycle phase:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(
    'lifecycle:teardown',
    async (
      _event,
      args: {
        taskId: string;
        taskPath: string;
        projectPath: string;
      }
    ) => {
      try {
        const result = await taskLifecycleService.runTeardown(
          args.taskId,
          args.taskPath,
          args.projectPath
        );
        return { success: result.ok, ...result };
      } catch (error) {
        log.error('Failed to run teardown lifecycle phase:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle('lifecycle:getState', async (_event, args: { taskId: string }) => {
    try {
      const state = taskLifecycleService.getState(args.taskId);
      return { success: true, state };
    } catch (error) {
      log.error('Failed to get lifecycle state:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  const forward = (evt: any) => {
    const all = BrowserWindow.getAllWindows();
    for (const win of all) {
      try {
        win.webContents.send(LIFECYCLE_EVENT_CHANNEL, evt);
      } catch {}
    }
  };
  taskLifecycleService.onEvent(forward);
}
