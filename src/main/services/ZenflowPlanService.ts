import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { parsePlanMd, writePlanMd, updateStepInPlan, addStepsToPlan } from '@shared/zenflow/planMd';
import type { PlanDocument, PlanStepData, WorkflowStepStatus } from '@shared/zenflow/types';
import { log } from '../lib/logger';

const PLAN_DEBOUNCE_MS = 500;
const ZENFLOW_DIR = '.zenflow';
const PLAN_FILE = 'plan.md';

/** Describes a step status transition detected from plan.md changes */
export interface StepStatusTransition {
  taskId: string;
  stepNumber: number;
  conversationId: string | null;
  oldStatus: WorkflowStepStatus;
  newStatus: WorkflowStepStatus;
}

export type StepTransitionListener = (transitions: StepStatusTransition[]) => void;

interface PlanWatcher {
  watcher: fs.FSWatcher;
  taskId: string;
  worktreePath: string;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Service for reading, writing, and watching plan.md files.
 * plan.md is the source of truth for zenflow workflow step state.
 */
export class ZenflowPlanService {
  private watchers = new Map<string, PlanWatcher>();
  /** Previous step statuses per task, keyed by taskId → Map<stepNumber, status> */
  private previousStatuses = new Map<string, Map<number, WorkflowStepStatus>>();
  /** Registered listeners for step status transitions */
  private transitionListeners: StepTransitionListener[] = [];

  /** Register a listener for step status transitions detected from plan.md file changes. */
  onStepTransition(listener: StepTransitionListener): () => void {
    this.transitionListeners.push(listener);
    return () => {
      this.transitionListeners = this.transitionListeners.filter((l) => l !== listener);
    };
  }

  /** Store the current step statuses as the baseline for a task. */
  snapshotStatuses(taskId: string, steps: PlanStepData[]): void {
    const map = new Map<number, WorkflowStepStatus>();
    for (const step of steps) {
      map.set(step.stepNumber, step.status);
    }
    this.previousStatuses.set(taskId, map);
  }

  /** Compare new steps against previous snapshot and return transitions. */
  private detectTransitions(taskId: string, steps: PlanStepData[]): StepStatusTransition[] {
    const prev = this.previousStatuses.get(taskId);
    if (!prev) return [];

    const transitions: StepStatusTransition[] = [];
    for (const step of steps) {
      const oldStatus = prev.get(step.stepNumber);
      if (oldStatus && oldStatus !== step.status) {
        transitions.push({
          taskId,
          stepNumber: step.stepNumber,
          conversationId: step.conversationId,
          oldStatus,
          newStatus: step.status,
        });
      }
    }
    return transitions;
  }

  private getPlanPath(worktreePath: string): string {
    return path.join(worktreePath, ZENFLOW_DIR, PLAN_FILE);
  }

  private getZenflowDir(worktreePath: string): string {
    return path.join(worktreePath, ZENFLOW_DIR);
  }

  /** Read and parse plan.md from a worktree. Returns null if not found. */
  async readPlan(worktreePath: string): Promise<PlanDocument | null> {
    const planPath = this.getPlanPath(worktreePath);
    try {
      const content = await fs.promises.readFile(planPath, 'utf-8');
      return parsePlanMd(content);
    } catch {
      return null;
    }
  }

  /** Write a PlanDocument to plan.md, creating .zenflow/ if needed. */
  async writePlan(worktreePath: string, plan: PlanDocument): Promise<void> {
    const zenflowDir = this.getZenflowDir(worktreePath);
    const planPath = this.getPlanPath(worktreePath);

    await fs.promises.mkdir(zenflowDir, { recursive: true });
    const content = writePlanMd(plan);
    await fs.promises.writeFile(planPath, content, 'utf-8');
  }

  /** Update a step's status in plan.md by conversationId. */
  async updateStepStatus(
    worktreePath: string,
    conversationId: string,
    status: string
  ): Promise<void> {
    const planPath = this.getPlanPath(worktreePath);
    try {
      const content = await fs.promises.readFile(planPath, 'utf-8');
      const updated = updateStepInPlan(content, conversationId, {
        status: status as PlanStepData['status'],
      });
      await fs.promises.writeFile(planPath, updated, 'utf-8');
    } catch (err) {
      log.error('[zenflow-plan] Failed to update step status in plan.md', err);
    }
  }

  /** Append new steps to plan.md (e.g., after planning step expansion). */
  async appendSteps(worktreePath: string, newSteps: PlanStepData[]): Promise<void> {
    const planPath = this.getPlanPath(worktreePath);
    try {
      const content = await fs.promises.readFile(planPath, 'utf-8');
      const updated = addStepsToPlan(content, newSteps);
      await fs.promises.writeFile(planPath, updated, 'utf-8');
    } catch (err) {
      log.error('[zenflow-plan] Failed to append steps to plan.md', err);
    }
  }

  /** Start watching plan.md for a task. Broadcasts changes to all renderer windows. */
  startWatching(taskId: string, worktreePath: string): void {
    // Already watching this task
    if (this.watchers.has(taskId)) return;

    const planPath = this.getPlanPath(worktreePath);
    const zenflowDir = this.getZenflowDir(worktreePath);

    // Ensure directory exists before watching
    if (!fs.existsSync(zenflowDir)) {
      try {
        fs.mkdirSync(zenflowDir, { recursive: true });
      } catch {
        log.warn('[zenflow-plan] Could not create .zenflow/ for watching');
        return;
      }
    }

    try {
      // Watch the .zenflow directory for changes to plan.md
      const watcher = fs.watch(zenflowDir, (_eventType, filename) => {
        if (filename !== PLAN_FILE) return;

        const entry = this.watchers.get(taskId);
        if (!entry) return;
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        entry.debounceTimer = setTimeout(async () => {
          try {
            const content = await fs.promises.readFile(planPath, 'utf-8');
            const plan = parsePlanMd(content);

            // Detect status transitions and notify listeners
            const transitions = this.detectTransitions(taskId, plan.steps);
            if (transitions.length > 0) {
              // Update snapshot before notifying (prevents re-triggering)
              this.snapshotStatuses(taskId, plan.steps);
              for (const listener of this.transitionListeners) {
                try {
                  listener(transitions);
                } catch (err) {
                  log.error('[zenflow-plan] Transition listener error', err);
                }
              }
            } else {
              // Update snapshot even without transitions (e.g. new steps added)
              this.snapshotStatuses(taskId, plan.steps);
            }

            this.broadcastPlanChanged(taskId, plan);
          } catch (err) {
            log.warn('[zenflow-plan] Error reading plan.md after change', err);
          }
        }, PLAN_DEBOUNCE_MS);
      });

      watcher.on('error', (error) => {
        log.warn('[zenflow-plan] Watcher error', error);
        this.stopWatching(taskId);
      });

      this.watchers.set(taskId, {
        watcher,
        taskId,
        worktreePath,
        debounceTimer: null,
      });
    } catch (err) {
      log.error('[zenflow-plan] Failed to start watching', err);
    }
  }

  /** Stop watching plan.md for a task. */
  stopWatching(taskId: string): void {
    const entry = this.watchers.get(taskId);
    if (!entry) return;

    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    try {
      entry.watcher.close();
    } catch {}
    this.watchers.delete(taskId);
    this.previousStatuses.delete(taskId);
  }

  /** Stop all watchers (e.g., on app quit). */
  stopAll(): void {
    for (const taskId of this.watchers.keys()) {
      this.stopWatching(taskId);
    }
  }

  private broadcastPlanChanged(taskId: string, plan: PlanDocument): void {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send('zenflow:plan-changed', { taskId, plan });
      } catch {}
    }
  }
}

export const zenflowPlanService = new ZenflowPlanService();
