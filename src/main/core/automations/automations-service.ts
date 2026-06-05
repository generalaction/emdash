import { desc, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { automationRuns } from '@main/db/schema';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';
import type {
  Automation,
  CreateAutomationParams,
  UpdateAutomationPatch,
} from '@shared/automations/automation';
import type { AutomationRun } from '@shared/automations/automation-run';
import {
  createAutomation as repoCreateAutomation,
  ensureNextCronRun,
  getAutomation,
  getRun,
  insertRun,
  listAutomations as repoListAutomations,
  removeAutomation,
  setAutomationEnabled as repoSetAutomationEnabled,
  skipQueuedCronRuns,
  updateAutomation as updateInRepo,
} from './repo';
import { markRunSkipped } from './run-transitions';
import { mapAutomationRunRowToAutomationRun } from './utils';

export type AutomationsServiceHooks = {
  'automation:created': (automation: Automation) => void | Promise<void>;
  'automation:updated': (automation: Automation) => void | Promise<void>;
  'automation:enabled': (automation: Automation) => void | Promise<void>;
  'automation:deleted': (id: string) => void | Promise<void>;
  'run:started': (run: AutomationRun) => void | Promise<void>;
  'run:stopped': (run: AutomationRun) => void | Promise<void>;
};

export class AutomationsService implements Hookable<AutomationsServiceHooks> {
  private readonly _hooks = new HookCore<AutomationsServiceHooks>((name, e) =>
    log.error(`AutomationsService: ${String(name)} hook error`, e)
  );

  on<K extends keyof AutomationsServiceHooks>(name: K, handler: AutomationsServiceHooks[K]) {
    return this._hooks.on(name, handler);
  }

  async listAutomations(projectId?: string): Promise<Automation[]> {
    return repoListAutomations(projectId);
  }

  async createAutomation(params: CreateAutomationParams): Promise<Automation> {
    const automation = await repoCreateAutomation(params);
    this._hooks.callHookBackground('automation:created', automation);
    return automation;
  }

  async updateAutomation(id: string, patch: UpdateAutomationPatch): Promise<Automation> {
    const automation = await updateInRepo(id, patch);
    if (!automation) throw new Error('automation_not_found');
    if (patch.triggerConfig !== undefined) {
      await skipQueuedCronRuns(id, 'trigger_changed');
      if (automation.enabled) await ensureNextCronRun(automation);
    }
    this._hooks.callHookBackground('automation:updated', automation);
    return automation;
  }

  async setAutomationEnabled(id: string, enabled: boolean): Promise<void> {
    const automation = await repoSetAutomationEnabled(id, enabled);
    if (!automation) throw new Error('automation_not_found');
    if (enabled) {
      await ensureNextCronRun(automation);
    } else {
      await skipQueuedCronRuns(id, 'disabled');
    }
    this._hooks.callHookBackground('automation:enabled', automation);
  }

  async listAutomationRuns(
    automationId: string,
    limit: number,
    offset: number
  ): Promise<AutomationRun[]> {
    const rows = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.automationId, automationId))
      .orderBy(desc(automationRuns.scheduledAt))
      .limit(limit)
      .offset(offset);
    return rows.map(mapAutomationRunRowToAutomationRun);
  }

  async runAutomation(id: string): Promise<AutomationRun> {
    const automation = await getAutomation(id);
    if (!automation) throw new Error('automation_not_found');
    if (!automation.projectId) throw new Error('no_project_attached');
    if (!automation.conversationConfig || !automation.triggerConfig)
      throw new Error('automation_not_configured');

    const now = Date.now();
    const run = await insertRun({
      automationId: id,
      triggerConfigSnapshot: automation.triggerConfig,
      conversationConfigSnapshot: automation.conversationConfig,
      taskConfigSnapshot: automation.taskConfig ?? null,
      scheduledAt: now,
      deadlineAt: null,
      status: 'creating_task',
      triggerKind: 'manual',
      startedAt: now,
    });

    // Lazy import to avoid circular dep: service is imported by scheduler.
    void import('./automation-scheduler').then(({ automationScheduler }) => {
      automationScheduler.executeNow(automation, run);
    });

    this._hooks.callHookBackground('run:started', run);
    return run;
  }

  async stopRun(runId: string): Promise<AutomationRun> {
    const run = await getRun(runId);
    if (!run) throw new Error('run_not_found');
    let stopped: AutomationRun;
    if (run.status === 'queued') {
      stopped = await markRunSkipped(runId, { step: 'queue', code: 'manually_stopped' });
    } else if (
      run.status === 'creating_task' ||
      run.status === 'launching_task' ||
      run.status === 'creating_conversation'
    ) {
      // In-progress steps — mark as failed (PTY stop is handled by renderer via run.taskId)
      stopped = await markRunSkipped(runId, { step: 'queue', code: 'manually_stopped' });
    } else {
      throw new Error('run_not_stoppable');
    }
    this._hooks.callHookBackground('run:stopped', stopped);
    return stopped;
  }

  async deleteAutomation(id: string): Promise<void> {
    await skipQueuedCronRuns(id, 'automation_deleted');
    const deleted = await removeAutomation(id);
    if (!deleted) throw new Error('automation_not_found');
    this._hooks.callHookBackground('automation:deleted', id);
  }
}

export const automationsService = new AutomationsService();
