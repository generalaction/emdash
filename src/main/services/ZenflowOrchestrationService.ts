import { EventEmitter } from 'node:events';
import fs from 'fs';
import path from 'path';
import { BrowserWindow } from 'electron';
import { log } from '../lib/logger';
import { databaseService } from './DatabaseService';
import { zenflowPlanService } from './ZenflowPlanService';
import { getZenflowTemplate } from '@shared/zenflow/templates';
import type {
  ZenflowEvent,
  ZenflowTemplateId,
  ZenflowWorkflowStatus,
  PlanStepData,
} from '@shared/zenflow/types';
import type { WorkflowStepInsert, WorkflowStepRow } from '../db/schema';

/**
 * Orchestrates zenflow workflows — manages step lifecycle, auto-chaining, and pause/resume.
 *
 * Runs in the main process. The renderer subscribes to plan.md changes for UI updates.
 * Each workflow step maps to a conversation (tab) + PTY. When a step's PTY exits,
 * this service decides whether to auto-chain to the next step or pause.
 *
 * Source of truth: plan.md in {worktree}/.zenflow/plan.md
 * Secondary index: workflowSteps DB table
 */
class ZenflowOrchestrationService extends EventEmitter {
  /** Maps PTY IDs to their workflow step for exit handling */
  private ptyToStep = new Map<string, { taskId: string; stepId: string }>();

  /**
   * Create a new zenflow workflow for a task.
   * Creates conversation records (one per step), step records in DB,
   * and writes the initial plan.md.
   */
  async createWorkflow(args: {
    taskId: string;
    template: ZenflowTemplateId;
    featureDescription: string;
    worktreePath: string;
  }): Promise<WorkflowStepRow[]> {
    const template = getZenflowTemplate(args.template);
    if (!template) {
      throw new Error(`Unknown zenflow template: ${args.template}`);
    }

    const artifactsDir = path.join(args.worktreePath, '.zenflow');
    fs.mkdirSync(artifactsDir, { recursive: true });

    // Create a conversation for each step (reuses emdash multi-chat system)
    const conversationIds: string[] = [];
    for (let i = 0; i < template.steps.length; i++) {
      const stepTemplate = template.steps[i];
      const stepNumber = i + 1;
      const conversation = await databaseService.createConversation(
        args.taskId,
        `Step ${stepNumber}: ${stepTemplate.name}`,
        'claude', // default provider; user can change per step
        stepNumber === 1 // first step is the "main" conversation
      );
      conversationIds.push(conversation.id);
    }

    // Create step records from template with conversation links
    const steps: WorkflowStepInsert[] = template.steps.map((stepTemplate, index) => {
      const stepNumber = index + 1;
      const prompt = this.resolvePromptTemplate(stepTemplate.promptTemplate, {
        featureDescription: args.featureDescription,
        artifactsDir: '.zenflow',
      });

      return {
        id: `step-${args.taskId}-${stepNumber}`,
        taskId: args.taskId,
        conversationId: conversationIds[index],
        stepNumber,
        name: stepTemplate.name,
        type: stepTemplate.type,
        status: 'pending',
        pauseAfter: stepTemplate.pauseAfter ? 1 : 0,
        prompt,
        artifactPaths: JSON.stringify(stepTemplate.outputArtifacts),
        metadata: stepTemplate.isDynamic ? JSON.stringify({ isDynamic: true }) : null,
        startedAt: null,
        completedAt: null,
      };
    });

    await databaseService.insertWorkflowSteps(steps);
    const savedSteps = await databaseService.getWorkflowSteps(args.taskId);

    // Write plan.md as source of truth with conversation IDs embedded
    const planSteps: PlanStepData[] = savedSteps.map((s) => ({
      stepNumber: s.stepNumber,
      name: s.name,
      type: s.type as PlanStepData['type'],
      status: s.status as PlanStepData['status'],
      conversationId: s.conversationId,
      pauseAfter: s.pauseAfter === 1,
    }));

    await zenflowPlanService.writePlan(args.worktreePath, {
      featureDescription: args.featureDescription,
      templateId: args.template,
      steps: planSteps,
    });

    // Start watching plan.md for changes (e.g., planning agent adding steps)
    zenflowPlanService.startWatching(args.taskId, args.worktreePath);

    return savedSteps;
  }

  /**
   * Register a PTY → step mapping so we can handle its exit.
   */
  registerPtyStep(ptyId: string, taskId: string, stepId: string): void {
    this.ptyToStep.set(ptyId, { taskId, stepId });
  }

  /**
   * Called when any PTY exits. If it belongs to a zenflow step, advance the workflow.
   * This is a no-op for non-zenflow PTYs.
   */
  async handlePtyExit(ptyId: string, exitCode: number): Promise<void> {
    const mapping = this.ptyToStep.get(ptyId);
    if (!mapping) return;

    const { taskId, stepId } = mapping;
    this.ptyToStep.delete(ptyId);

    const step = await databaseService.getWorkflowStep(stepId);
    if (!step) {
      log.warn('zenflow: step not found for PTY exit', { ptyId, stepId });
      return;
    }

    if (exitCode === 0) {
      await databaseService.updateWorkflowStepStatus(stepId, 'completed', {
        completedAt: new Date().toISOString(),
      });

      // Update plan.md (source of truth)
      if (step.conversationId) {
        const worktreePath = await this.getWorktreePath(taskId);
        if (worktreePath) {
          await zenflowPlanService.updateStepStatus(worktreePath, step.conversationId, 'completed');
        }
      }

      // Update task metadata
      const steps = await databaseService.getWorkflowSteps(taskId);
      const nextPending = steps.find((s) => s.status === 'pending');
      await this.updateTaskZenflowMetadata(taskId, {
        currentStepNumber: nextPending?.stepNumber ?? step.stepNumber,
        status: nextPending ? (step.pauseAfter ? 'paused' : 'running') : 'completed',
      });

      this.emitEvent({
        taskId,
        type: 'step-completed',
        stepId,
        stepNumber: step.stepNumber,
        conversationId: step.conversationId ?? undefined,
      });

      if (!nextPending) {
        this.emitEvent({ taskId, type: 'workflow-completed' });
        return;
      }

      if (step.pauseAfter) {
        this.emitEvent({
          taskId,
          type: 'workflow-paused',
          stepNumber: step.stepNumber,
          data: { reason: 'pause_point', completedStep: step.name },
        });
        return;
      }

      // Auto-chain: start next step
      await this.startNextStep(taskId);
    } else {
      await databaseService.updateWorkflowStepStatus(stepId, 'failed');

      // Update plan.md
      if (step.conversationId) {
        const worktreePath = await this.getWorktreePath(taskId);
        if (worktreePath) {
          await zenflowPlanService.updateStepStatus(worktreePath, step.conversationId, 'failed');
        }
      }

      await this.updateTaskZenflowMetadata(taskId, { status: 'failed' });
      this.emitEvent({
        taskId,
        type: 'step-failed',
        stepId,
        stepNumber: step.stepNumber,
        conversationId: step.conversationId ?? undefined,
        data: { exitCode },
      });
    }
  }

  /**
   * Find and return the next pending step for a task.
   */
  async getNextPendingStep(taskId: string): Promise<WorkflowStepRow | null> {
    const steps = await databaseService.getWorkflowSteps(taskId);
    return steps.find((s) => s.status === 'pending') ?? null;
  }

  /**
   * Start the next pending step. Emits 'step-started' for the renderer to switch tab.
   */
  async startNextStep(taskId: string): Promise<WorkflowStepRow | null> {
    const nextStep = await this.getNextPendingStep(taskId);
    if (!nextStep) {
      log.info('zenflow: no more pending steps', { taskId });
      return null;
    }

    await this.startStep(taskId, nextStep.id);
    return nextStep;
  }

  /**
   * Start a specific step — mark it running, update plan.md, and emit event.
   * The renderer switches to the step's conversation tab and spawns the PTY.
   */
  async startStep(taskId: string, stepId: string): Promise<void> {
    await databaseService.updateWorkflowStepStatus(stepId, 'running', {
      startedAt: new Date().toISOString(),
    });

    const step = await databaseService.getWorkflowStep(stepId);
    if (!step) return;

    // Update plan.md
    if (step.conversationId) {
      const worktreePath = await this.getWorktreePath(taskId);
      if (worktreePath) {
        await zenflowPlanService.updateStepStatus(worktreePath, step.conversationId, 'running');
      }
    }

    await this.updateTaskZenflowMetadata(taskId, {
      currentStepNumber: step.stepNumber,
      status: 'running',
    });

    this.emitEvent({
      taskId,
      type: 'step-started',
      stepId,
      stepNumber: step.stepNumber,
      conversationId: step.conversationId ?? undefined,
      data: {
        name: step.name,
        type: step.type,
        prompt: step.prompt,
      },
    });
  }

  /**
   * Pause a running workflow.
   */
  async pauseWorkflow(taskId: string): Promise<void> {
    await this.updateTaskZenflowMetadata(taskId, { status: 'paused' });
    this.emitEvent({ taskId, type: 'workflow-paused' });
  }

  /**
   * Resume a paused workflow — start the next pending step.
   */
  async resumeWorkflow(taskId: string): Promise<void> {
    await this.updateTaskZenflowMetadata(taskId, { status: 'running' });
    await this.startNextStep(taskId);
  }

  /**
   * Retry a failed step — reset its status and start it again.
   */
  async retryStep(stepId: string): Promise<void> {
    const step = await databaseService.getWorkflowStep(stepId);
    if (!step) return;

    await databaseService.updateWorkflowStepStatus(stepId, 'pending', {
      startedAt: undefined,
      completedAt: undefined,
    });
    await this.startStep(step.taskId, stepId);
  }

  /**
   * Dynamically expand the workflow with new implementation steps.
   * Creates new conversations and step records, updates plan.md.
   */
  async expandSteps(
    taskId: string,
    newSteps: Array<{ name: string; prompt: string }>
  ): Promise<WorkflowStepRow[]> {
    const existingSteps = await databaseService.getWorkflowSteps(taskId);
    const maxStepNumber = Math.max(...existingSteps.map((s) => s.stepNumber), 0);

    // Create conversations for each new step
    const conversationIds: string[] = [];
    for (let i = 0; i < newSteps.length; i++) {
      const stepNumber = maxStepNumber + 1 + i;
      const conversation = await databaseService.createConversation(
        taskId,
        `Step ${stepNumber}: ${newSteps[i].name}`,
        'claude',
        false
      );
      conversationIds.push(conversation.id);
    }

    const stepRecords: WorkflowStepInsert[] = newSteps.map((s, i) => {
      const stepNumber = maxStepNumber + 1 + i;
      return {
        id: `step-${taskId}-${stepNumber}`,
        taskId,
        conversationId: conversationIds[i],
        stepNumber,
        name: s.name,
        type: 'implementation',
        status: 'pending',
        pauseAfter: 0,
        prompt: s.prompt,
        artifactPaths: JSON.stringify([`report-step${stepNumber}.md`]),
        metadata: null,
        startedAt: null,
        completedAt: null,
      };
    });

    await databaseService.insertWorkflowSteps(stepRecords);

    const allSteps = await databaseService.getWorkflowSteps(taskId);
    await this.updateTaskZenflowMetadata(taskId, { totalSteps: allSteps.length });

    // Update plan.md with new steps
    const worktreePath = await this.getWorktreePath(taskId);
    if (worktreePath) {
      const newPlanSteps: PlanStepData[] = stepRecords.map((_s, i) => ({
        stepNumber: maxStepNumber + 1 + i,
        name: newSteps[i].name,
        type: 'implementation',
        status: 'pending',
        conversationId: conversationIds[i],
        pauseAfter: false,
      }));
      await zenflowPlanService.appendSteps(worktreePath, newPlanSteps);
    }

    this.emitEvent({
      taskId,
      type: 'steps-expanded',
      data: { newStepCount: newSteps.length, totalSteps: allSteps.length },
    });

    return allSteps;
  }

  /**
   * Link a conversation ID to a workflow step.
   */
  async linkConversation(stepId: string, conversationId: string): Promise<void> {
    await databaseService.updateWorkflowStepStatus(stepId, 'running', { conversationId });
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  private resolvePromptTemplate(
    template: string,
    context: { featureDescription: string; artifactsDir: string }
  ): string {
    return template
      .replace(/\{\{featureDescription\}\}/g, context.featureDescription)
      .replace(/\{\{artifactsDir\}\}/g, context.artifactsDir);
  }

  private async getWorktreePath(taskId: string): Promise<string | null> {
    try {
      const task = await databaseService.getTask(taskId);
      return task?.path ?? null;
    } catch {
      return null;
    }
  }

  private async updateTaskZenflowMetadata(
    taskId: string,
    updates: Partial<{
      currentStepNumber: number;
      totalSteps: number;
      status: ZenflowWorkflowStatus;
    }>
  ): Promise<void> {
    try {
      const task = await databaseService.getTask(taskId);
      if (!task) return;

      const metadata =
        typeof task.metadata === 'string' ? JSON.parse(task.metadata) : task.metadata;
      if (!metadata?.zenflow) return;

      Object.assign(metadata.zenflow, updates);
      await databaseService.saveTask({
        ...task,
        metadata: JSON.stringify(metadata),
      });
    } catch (err) {
      log.error('zenflow: failed to update task metadata', { taskId, error: err });
    }
  }

  private emitEvent(event: ZenflowEvent): void {
    this.emit('zenflow-event', event);

    // Also broadcast to all renderer windows
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('zenflow:event', event);
      }
    }
  }

  /**
   * Subscribe to zenflow events in the main process.
   */
  onEvent(listener: (event: ZenflowEvent) => void): () => void {
    this.on('zenflow-event', listener);
    return () => this.off('zenflow-event', listener);
  }
}

export const zenflowOrchestrationService = new ZenflowOrchestrationService();
