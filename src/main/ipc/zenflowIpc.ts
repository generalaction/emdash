import { ipcMain } from 'electron';
import { zenflowOrchestrationService } from '../services/ZenflowOrchestrationService';
import { zenflowPlanService } from '../services/ZenflowPlanService';
import { databaseService } from '../services/DatabaseService';
import { log } from '../lib/logger';
import type { PlanDocument } from '@shared/zenflow/types';

export function registerZenflowIpc(): void {
  ipcMain.handle(
    'zenflow:createWorkflow',
    async (
      _,
      args: {
        taskId: string;
        template: 'spec-and-build' | 'full-sdd';
        featureDescription: string;
        worktreePath: string;
      }
    ) => {
      try {
        const steps = await zenflowOrchestrationService.createWorkflow(args);
        return { success: true, data: steps };
      } catch (error: any) {
        log.error('zenflow:createWorkflow failed', { error: error.message });
        return { success: false, error: error.message };
      }
    }
  );

  ipcMain.handle('zenflow:getSteps', async (_, taskId: string) => {
    try {
      const steps = await databaseService.getWorkflowSteps(taskId);
      return { success: true, data: steps };
    } catch (error: any) {
      log.error('zenflow:getSteps failed', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('zenflow:resumeWorkflow', async (_, taskId: string) => {
    try {
      await zenflowOrchestrationService.resumeWorkflow(taskId);
      return { success: true };
    } catch (error: any) {
      log.error('zenflow:resumeWorkflow failed', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('zenflow:pauseWorkflow', async (_, taskId: string) => {
    try {
      await zenflowOrchestrationService.pauseWorkflow(taskId);
      return { success: true };
    } catch (error: any) {
      log.error('zenflow:pauseWorkflow failed', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('zenflow:retryStep', async (_, stepId: string) => {
    try {
      await zenflowOrchestrationService.retryStep(stepId);
      return { success: true };
    } catch (error: any) {
      log.error('zenflow:retryStep failed', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    'zenflow:expandSteps',
    async (_, args: { taskId: string; newSteps: Array<{ name: string; prompt: string }> }) => {
      try {
        const steps = await zenflowOrchestrationService.expandSteps(args.taskId, args.newSteps);
        return { success: true, data: steps };
      } catch (error: any) {
        log.error('zenflow:expandSteps failed', { error: error.message });
        return { success: false, error: error.message };
      }
    }
  );

  ipcMain.handle('zenflow:startStep', async (_, args: { taskId: string; stepId: string }) => {
    try {
      await zenflowOrchestrationService.startStep(args.taskId, args.stepId);
      return { success: true };
    } catch (error: any) {
      log.error('zenflow:startStep failed', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    'zenflow:registerPtyStep',
    async (_, args: { ptyId: string; taskId: string; stepId: string }) => {
      try {
        zenflowOrchestrationService.registerPtyStep(args.ptyId, args.taskId, args.stepId);
        return { success: true };
      } catch (error: any) {
        log.error('zenflow:registerPtyStep failed', { error: error.message });
        return { success: false, error: error.message };
      }
    }
  );

  ipcMain.handle(
    'zenflow:linkConversation',
    async (_, args: { stepId: string; conversationId: string }) => {
      try {
        await zenflowOrchestrationService.linkConversation(args.stepId, args.conversationId);
        return { success: true };
      } catch (error: any) {
        log.error('zenflow:linkConversation failed', { error: error.message });
        return { success: false, error: error.message };
      }
    }
  );

  // --- plan.md file-based IPC ---

  ipcMain.handle('zenflow:readPlan', async (_, worktreePath: string) => {
    try {
      const plan = await zenflowPlanService.readPlan(worktreePath);
      return { success: true, data: plan };
    } catch (error: any) {
      log.error('zenflow:readPlan failed', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    'zenflow:writePlan',
    async (_, args: { worktreePath: string; plan: PlanDocument }) => {
      try {
        await zenflowPlanService.writePlan(args.worktreePath, args.plan);
        return { success: true };
      } catch (error: any) {
        log.error('zenflow:writePlan failed', { error: error.message });
        return { success: false, error: error.message };
      }
    }
  );

  ipcMain.handle('zenflow:watchPlan', async (_, args: { taskId: string; worktreePath: string }) => {
    try {
      zenflowPlanService.startWatching(args.taskId, args.worktreePath);
      return { success: true };
    } catch (error: any) {
      log.error('zenflow:watchPlan failed', { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('zenflow:unwatchPlan', async (_, taskId: string) => {
    try {
      zenflowPlanService.stopWatching(taskId);
      return { success: true };
    } catch (error: any) {
      log.error('zenflow:unwatchPlan failed', { error: error.message });
      return { success: false, error: error.message };
    }
  });
}
