import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { db } from '@main/db/client';
import { automationRuns } from '@main/db/schema';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';
import type {
  Automation,
  CreateAutomationParams,
  UpdateAutomationSettingsPatch,
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
  renameAutomation as renameInRepo,
  setAutomationEnabled as repoSetAutomationEnabled,
  skipQueuedCronRuns,
  updateAutomationSettings as updateSettingsInRepo,
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
  'run:step-completed': (run: AutomationRun) => void | Promise<void>;
};

export class AutomationsService implements Hookable<AutomationsServiceHooks> {
  private readonly _hooks = new HookCore<AutomationsServiceHooks>((name, e) =>
    log.error(`AutomationsService: ${String(name)} hook error`, e)
  );

  on<K extends keyof AutomationsServiceHooks>(name: K, handler: AutomationsServiceHooks[K]) {
    return this._hooks.on(name, handler);
  }

  notifyRunStep(run: AutomationRun): void {
    this._hooks.callHookBackground('run:step-completed', run);
  }

  async listAutomations(projectId?: string): Promise<Automation[]> {
    return repoListAutomations(projectId);
  }

  async createAutomation(params: CreateAutomationParams): Promise<Automation> {
    const automation = await repoCreateAutomation(params);
    this._hooks.callHookBackground('automation:created', automation);
    return automation;
  }

  async updateAutomationSettings(id: string, patch: UpdateAutomationSettingsPatch): Promise<Automation> {
    const automation = await updateSettingsInRepo(id, patch);
    if (!automation) throw new Error('automation_not_found');
    if (patch.triggerConfig !== undefined) {
      await skipQueuedCronRuns(id, 'trigger_changed');
      if (automation.enabled) await ensureNextCronRun(automation);
    }
    this._hooks.callHookBackground('automation:updated', automation);
    return automation;
  }

  async renameAutomation(id: string, name: string): Promise<Automation> {
    const automation = await renameInRepo(id, name);
    if (!automation) throw new Error('automation_not_found');
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
      .where(and(eq(automationRuns.automationId, automationId), ne(automationRuns.status, 'scheduled')))
      .orderBy(desc(automationRuns.scheduledAt))
      .limit(limit)
      .offset(offset);
    return rows.map(mapAutomationRunRowToAutomationRun);
  }

  async getNextScheduledRun(automationId: string): Promise<AutomationRun | null> {
    const rows = await db
      .select()
      .from(automationRuns)
      .where(
        and(eq(automationRuns.automationId, automationId), eq(automationRuns.status, 'scheduled'))
      )
      .orderBy(asc(automationRuns.scheduledAt))
      .limit(1);
    return rows[0] ? mapAutomationRunRowToAutomationRun(rows[0]) : null;
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
    this._hooks.callHookBackground('run:step-completed', stopped);
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
