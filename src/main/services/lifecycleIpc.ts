import { lifecycleScriptsService } from './LifecycleScriptsService';
import { log } from '../lib/logger';
import { LIFECYCLE_PHASES } from '@shared/lifecycle';
import { taskLifecycleService } from './TaskLifecycleService';
import { createRPCController } from '../../shared/ipc/rpc';
import { events } from '../events';
import { lifecycleEventChannel } from '@shared/events/lifecycleEvents';

export const lifecycleController = createRPCController({
  getScript: async (args: { projectPath: string; phase: string }) => {
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
  },

  setup: async (args: {
    taskId: string;
    taskPath: string;
    projectPath: string;
    taskName?: string;
  }) => {
    try {
      const result = await taskLifecycleService.runSetup(
        args.taskId,
        args.taskPath,
        args.projectPath,
        args.taskName
      );
      return { success: result.ok, ...result };
    } catch (error) {
      log.error('Failed to run setup lifecycle phase:', error);
      return { success: false, error: (error as Error).message };
    }
  },

  runStart: async (args: {
    taskId: string;
    taskPath: string;
    projectPath: string;
    taskName?: string;
  }) => {
    try {
      const result = await taskLifecycleService.startRun(
        args.taskId,
        args.taskPath,
        args.projectPath,
        args.taskName
      );
      return { success: result.ok, ...result };
    } catch (error) {
      log.error('Failed to start run lifecycle phase:', error);
      return { success: false, error: (error as Error).message };
    }
  },

  runStop: async (args: { taskId: string }) => {
    try {
      const result = taskLifecycleService.stopRun(args.taskId);
      return { success: result.ok, ...result };
    } catch (error) {
      log.error('Failed to stop run lifecycle phase:', error);
      return { success: false, error: (error as Error).message };
    }
  },

  teardown: async (args: {
    taskId: string;
    taskPath: string;
    projectPath: string;
    taskName?: string;
  }) => {
    try {
      const result = await taskLifecycleService.runTeardown(
        args.taskId,
        args.taskPath,
        args.projectPath,
        args.taskName
      );
      return { success: result.ok, ...result };
    } catch (error) {
      log.error('Failed to run teardown lifecycle phase:', error);
      return { success: false, error: (error as Error).message };
    }
  },

  getState: async (args: { taskId: string }) => {
    try {
      const state = taskLifecycleService.getState(args.taskId);
      return { success: true, state };
    } catch (error) {
      log.error('Failed to get lifecycle state:', error);
      return { success: false, error: (error as Error).message };
    }
  },

  clearTask: async (args: { taskId: string }) => {
    try {
      taskLifecycleService.clearTask(args.taskId);
      return { success: true };
    } catch (error) {
      log.error('Failed to clear lifecycle state for task:', error);
      return { success: false, error: (error as Error).message };
    }
  },
});

export function registerLifecycleEvents(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  taskLifecycleService.onEvent((evt: any) => {
    events.emit(lifecycleEventChannel, evt);
  });
}
