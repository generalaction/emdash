import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { getDrizzleClient } from '../db/drizzleClient';
import {
  automationRunLogs as automationRunLogsTable,
  automations as automationsTable,
} from '../db/schema';
import type { AutomationRow, AutomationRunLogRow } from '../db/schema';
import { log } from '../lib/logger';
import type {
  Automation,
  AutomationRunLog,
  AutomationSchedule,
  CreateAutomationInput,
  DayOfWeek,
  ScheduleType,
  UpdateAutomationInput,
} from '../../shared/automations/types';

// ---------------------------------------------------------------------------
// AsyncMutex — promise-chaining based mutex for serializing async operations
// ---------------------------------------------------------------------------

class AsyncMutex {
  private chain: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.chain = this.chain.then(async () => {
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        }
      });
    });
  }
}

// Single mutex for all data operations — avoids fragile nested locking
const dataMutex = new AsyncMutex();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_ORDER: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const VALID_SCHEDULE_TYPES: ScheduleType[] = ['hourly', 'daily', 'weekly', 'monthly'];
const VALID_AUTOMATION_STATUS: Automation['status'][] = ['active', 'paused', 'error'];
const VALID_RUN_STATUS: AutomationRunLog['status'][] = ['running', 'success', 'failure'];

const MAX_RUNS_PER_AUTOMATION = 100;
const MAX_TOTAL_RUNS = 2000;
const DEFAULT_MAX_RUN_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

// ---------------------------------------------------------------------------
// Validation & helpers
// ---------------------------------------------------------------------------

function validateSchedule(schedule: AutomationSchedule): void {
  if (!VALID_SCHEDULE_TYPES.includes(schedule.type)) {
    throw new Error(`Invalid schedule type: ${schedule.type}`);
  }
  if (schedule.hour !== undefined && (schedule.hour < 0 || schedule.hour > 23)) {
    throw new Error(`Invalid hour: ${schedule.hour} (must be 0-23)`);
  }
  if (schedule.minute !== undefined && (schedule.minute < 0 || schedule.minute > 59)) {
    throw new Error(`Invalid minute: ${schedule.minute} (must be 0-59)`);
  }
  if (schedule.type === 'weekly' && schedule.dayOfWeek && !DAY_ORDER.includes(schedule.dayOfWeek)) {
    throw new Error(`Invalid dayOfWeek: ${schedule.dayOfWeek}`);
  }
  if (schedule.type === 'monthly') {
    const dom = schedule.dayOfMonth ?? 1;
    if (dom < 1 || dom > 31) {
      throw new Error(`Invalid dayOfMonth: ${dom} (must be 1-31)`);
    }
  }
}

function computeNextRun(schedule: AutomationSchedule, fromDate?: Date): string {
  const now = fromDate ?? new Date();
  const next = new Date(now);

  const hour = schedule.hour ?? 0;
  const minute = schedule.minute ?? 0;

  switch (schedule.type) {
    case 'hourly': {
      next.setMinutes(minute, 0, 0);
      if (next <= now) {
        next.setHours(next.getHours() + 1);
      }
      break;
    }
    case 'daily': {
      next.setHours(hour, minute, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      break;
    }
    case 'weekly': {
      const targetDay = DAY_ORDER.indexOf(schedule.dayOfWeek ?? 'mon');
      const currentDay = next.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil < 0) daysUntil += 7;
      if (daysUntil === 0) {
        next.setHours(hour, minute, 0, 0);
        if (next <= now) {
          daysUntil = 7;
        }
      }
      if (daysUntil > 0) {
        next.setDate(next.getDate() + daysUntil);
      }
      next.setHours(hour, minute, 0, 0);
      break;
    }
    case 'monthly': {
      const desiredDom = schedule.dayOfMonth ?? 1;
      // Clamp to the last day of the current month
      const daysInCurrentMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      const targetDom = Math.min(desiredDom, daysInCurrentMonth);
      next.setDate(targetDom);
      next.setHours(hour, minute, 0, 0);
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
        const daysInNextMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next.setDate(Math.min(desiredDom, daysInNextMonth));
        next.setHours(hour, minute, 0, 0);
      }
      break;
    }
  }

  return next.toISOString();
}

function generateId(): string {
  return `auto_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function normalizeAutomationStatus(value: unknown): Automation['status'] {
  if (
    typeof value === 'string' &&
    VALID_AUTOMATION_STATUS.includes(value as Automation['status'])
  ) {
    return value as Automation['status'];
  }
  return 'active';
}

function normalizeRunStatus(value: unknown): AutomationRunLog['status'] {
  if (typeof value === 'string' && VALID_RUN_STATUS.includes(value as AutomationRunLog['status'])) {
    return value as AutomationRunLog['status'];
  }
  return 'running';
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function serializeSchedule(schedule: AutomationSchedule): string {
  return JSON.stringify(schedule);
}

function deserializeSchedule(serialized: string): AutomationSchedule {
  const parsed = JSON.parse(serialized) as AutomationSchedule;
  validateSchedule(parsed);
  return parsed;
}

function mapAutomationRow(row: AutomationRow): Automation {
  return {
    id: row.id,
    name: row.name,
    projectId: row.projectId,
    projectName: row.projectName,
    prompt: row.prompt,
    agentId: row.agentId,
    schedule: deserializeSchedule(row.schedule),
    useWorktree: row.useWorktree === 1,
    status: normalizeAutomationStatus(row.status),
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    runCount: row.runCount,
    lastRunResult:
      row.lastRunResult === 'success' || row.lastRunResult === 'failure' ? row.lastRunResult : null,
    lastRunError: row.lastRunError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRunRow(row: AutomationRunLogRow): AutomationRunLog {
  return {
    id: row.id,
    automationId: row.automationId,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: normalizeRunStatus(row.status),
    error: row.error,
    taskId: row.taskId,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

type AutomationTriggerCallback = (automation: Automation, runLogId: string) => void;

class AutomationsService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private triggerCallbacks: AutomationTriggerCallback[] = [];
  private ticking = false;
  private initialized = false;

  // -------------------------------------------------------------------
  // Initialization — runs once to ensure DB client is ready.
  // Tables are created by DatabaseService.ensureMigrations() in production
  // via drizzle/0011_add_automations_tables.sql.
  // -------------------------------------------------------------------

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    await getDrizzleClient();
    this.initialized = true;
  }

  /** Reset internal state — test-only, not part of the public API. */
  _resetForTesting(): void {
    this.initialized = false;
    this.ticking = false;
    this.stop();
  }

  // -------------------------------------------------------------------
  // Scheduler
  // -------------------------------------------------------------------

  onTrigger(cb: AutomationTriggerCallback): void {
    this.triggerCallbacks.push(cb);
  }

  start(): void {
    if (this.timer) return;
    log.info('[Automations] Scheduler started');
    this.timer = setInterval(() => void this.tick(), 30_000);
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info('[Automations] Scheduler stopped');
    }
  }

  // Prevent overlapping ticks — if the previous tick is still running, skip
  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.executeTick();
    } catch (err) {
      log.error('[Automations] Tick failed:', err);
    } finally {
      this.ticking = false;
    }
  }

  private async executeTick(): Promise<void> {
    const triggers: Array<{ automation: Automation; runLogId: string }> = [];

    await dataMutex.run(async () => {
      await this.ensureInitialized();
      const { db } = await getDrizzleClient();
      const now = new Date();
      const nowIso = now.toISOString();

      const dueRows = await db
        .select()
        .from(automationsTable)
        .where(and(eq(automationsTable.status, 'active'), lte(automationsTable.nextRunAt, nowIso)));

      for (const row of dueRows) {
        const automation = mapAutomationRow(row);
        if (!automation.nextRunAt) continue;

        const runLogId = generateId();
        const nextRunAt = computeNextRun(automation.schedule, now);
        const nextRunCount = automation.runCount + 1;

        await db
          .update(automationsTable)
          .set({
            lastRunAt: nowIso,
            runCount: nextRunCount,
            nextRunAt,
            updatedAt: nowIso,
          })
          .where(eq(automationsTable.id, automation.id));

        await this.insertRunLog({
          id: runLogId,
          automationId: automation.id,
          startedAt: nowIso,
          finishedAt: null,
          status: 'running',
          error: null,
          taskId: null,
        });

        triggers.push({
          automation: {
            ...automation,
            lastRunAt: nowIso,
            runCount: nextRunCount,
            nextRunAt,
            updatedAt: nowIso,
          },
          runLogId,
        });
      }
    });

    for (const { automation, runLogId } of triggers) {
      for (const cb of this.triggerCallbacks) {
        try {
          cb(automation, runLogId);
        } catch (err) {
          log.error(`[Automations] Trigger callback failed for ${automation.id}:`, err);
          await this.setLastRunResult(
            automation.id,
            'failure',
            err instanceof Error ? err.message : String(err)
          );
        }
      }
    }
  }

  // -------------------------------------------------------------------
  // Run log internals — always called under dataMutex
  // -------------------------------------------------------------------

  /**
   * Insert a run log and enforce per-automation and global retention limits.
   * Must be called while dataMutex is held.
   */
  private async insertRunLog(runLog: AutomationRunLog): Promise<void> {
    const { db } = await getDrizzleClient();

    await db
      .insert(automationRunLogsTable)
      .values({
        id: runLog.id,
        automationId: runLog.automationId,
        startedAt: runLog.startedAt,
        finishedAt: runLog.finishedAt,
        status: runLog.status,
        error: runLog.error,
        taskId: runLog.taskId,
      })
      .onConflictDoNothing();

    // Enforce per-automation limit
    const perAutomationRows = await db
      .select({ id: automationRunLogsTable.id })
      .from(automationRunLogsTable)
      .where(eq(automationRunLogsTable.automationId, runLog.automationId))
      .orderBy(desc(automationRunLogsTable.startedAt), desc(automationRunLogsTable.id));

    if (perAutomationRows.length > MAX_RUNS_PER_AUTOMATION) {
      const idsToDelete = perAutomationRows.slice(MAX_RUNS_PER_AUTOMATION).map((row) => row.id);
      await db
        .delete(automationRunLogsTable)
        .where(inArray(automationRunLogsTable.id, idsToDelete));
    }

    // Enforce global limit
    const allRows = await db
      .select({ id: automationRunLogsTable.id })
      .from(automationRunLogsTable)
      .orderBy(desc(automationRunLogsTable.startedAt), desc(automationRunLogsTable.id));

    if (allRows.length > MAX_TOTAL_RUNS) {
      const idsToDelete = allRows.slice(MAX_TOTAL_RUNS).map((row) => row.id);
      await db
        .delete(automationRunLogsTable)
        .where(inArray(automationRunLogsTable.id, idsToDelete));
    }
  }

  // -------------------------------------------------------------------
  // Public CRUD
  // -------------------------------------------------------------------

  async list(): Promise<Automation[]> {
    await this.ensureInitialized();
    const { db } = await getDrizzleClient();
    const rows = await db
      .select()
      .from(automationsTable)
      .orderBy(sql`rowid asc`);
    return rows.map(mapAutomationRow);
  }

  async get(id: string): Promise<Automation | null> {
    await this.ensureInitialized();
    const { db } = await getDrizzleClient();
    const rows = await db
      .select()
      .from(automationsTable)
      .where(eq(automationsTable.id, id))
      .limit(1);
    const row = rows[0];
    return row ? mapAutomationRow(row) : null;
  }

  async create(input: CreateAutomationInput): Promise<Automation> {
    validateSchedule(input.schedule);
    await this.ensureInitialized();

    const now = new Date().toISOString();
    const automation: Automation = {
      id: generateId(),
      name: input.name,
      projectId: input.projectId,
      projectName: input.projectName ?? '',
      prompt: input.prompt,
      agentId: input.agentId,
      schedule: input.schedule,
      useWorktree: input.useWorktree ?? true,
      status: 'active',
      lastRunAt: null,
      nextRunAt: computeNextRun(input.schedule),
      runCount: 0,
      lastRunResult: null,
      lastRunError: null,
      createdAt: now,
      updatedAt: now,
    };

    const { db } = await getDrizzleClient();
    await db.insert(automationsTable).values({
      id: automation.id,
      projectId: automation.projectId,
      projectName: automation.projectName,
      name: automation.name,
      prompt: automation.prompt,
      agentId: automation.agentId,
      schedule: serializeSchedule(automation.schedule),
      useWorktree: automation.useWorktree ? 1 : 0,
      status: automation.status,
      lastRunAt: automation.lastRunAt,
      nextRunAt: automation.nextRunAt,
      runCount: automation.runCount,
      lastRunResult: automation.lastRunResult,
      lastRunError: automation.lastRunError,
      createdAt: automation.createdAt,
      updatedAt: automation.updatedAt,
    });

    log.info(`[Automations] Created automation: ${automation.name} (${automation.id})`);
    return automation;
  }

  async update(input: UpdateAutomationInput): Promise<Automation | null> {
    if (input.schedule) {
      validateSchedule(input.schedule);
    }

    await this.ensureInitialized();
    const { db } = await getDrizzleClient();

    const rows = await db
      .select()
      .from(automationsTable)
      .where(eq(automationsTable.id, input.id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    const current = mapAutomationRow(row);
    const nextSchedule = input.schedule ?? current.schedule;
    const nextUpdatedAt = new Date().toISOString();

    const updated: Automation = {
      ...current,
      name: input.name ?? current.name,
      projectId: input.projectId ?? current.projectId,
      projectName: input.projectName ?? current.projectName,
      prompt: input.prompt ?? current.prompt,
      agentId: input.agentId ?? current.agentId,
      status: input.status ?? current.status,
      useWorktree: input.useWorktree ?? current.useWorktree,
      schedule: nextSchedule,
      nextRunAt: input.schedule ? computeNextRun(nextSchedule) : current.nextRunAt,
      updatedAt: nextUpdatedAt,
    };

    await db
      .update(automationsTable)
      .set({
        name: updated.name,
        projectId: updated.projectId,
        projectName: updated.projectName,
        prompt: updated.prompt,
        agentId: updated.agentId,
        schedule: serializeSchedule(updated.schedule),
        useWorktree: updated.useWorktree ? 1 : 0,
        status: updated.status,
        nextRunAt: updated.nextRunAt,
        updatedAt: updated.updatedAt,
      })
      .where(eq(automationsTable.id, updated.id));

    log.info(`[Automations] Updated automation: ${updated.name} (${updated.id})`);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const { db } = await getDrizzleClient();

    const before = await db
      .select({ id: automationsTable.id })
      .from(automationsTable)
      .where(eq(automationsTable.id, id))
      .limit(1);
    if (before.length === 0) return false;

    await db.delete(automationRunLogsTable).where(eq(automationRunLogsTable.automationId, id));
    await db.delete(automationsTable).where(eq(automationsTable.id, id));
    log.info(`[Automations] Deleted automation: ${id}`);
    return true;
  }

  async toggleStatus(id: string): Promise<Automation | null> {
    await this.ensureInitialized();
    const { db } = await getDrizzleClient();

    const rows = await db
      .select()
      .from(automationsTable)
      .where(eq(automationsTable.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    const automation = mapAutomationRow(row);
    const nextStatus: Automation['status'] = automation.status === 'active' ? 'paused' : 'active';
    const nowIso = new Date().toISOString();

    const updated: Automation = {
      ...automation,
      status: nextStatus,
      nextRunAt:
        nextStatus === 'active' ? computeNextRun(automation.schedule) : automation.nextRunAt,
      lastRunError: nextStatus === 'active' ? null : automation.lastRunError,
      updatedAt: nowIso,
    };

    await db
      .update(automationsTable)
      .set({
        status: updated.status,
        nextRunAt: updated.nextRunAt,
        lastRunError: updated.lastRunError,
        updatedAt: updated.updatedAt,
      })
      .where(eq(automationsTable.id, id));

    return updated;
  }

  // -------------------------------------------------------------------
  // Run logs — public API
  // -------------------------------------------------------------------

  async getRunLogs(automationId: string, limit = 20): Promise<AutomationRunLog[]> {
    await this.ensureInitialized();
    const { db } = await getDrizzleClient();

    const rows = await db
      .select()
      .from(automationRunLogsTable)
      .where(eq(automationRunLogsTable.automationId, automationId))
      .orderBy(desc(automationRunLogsTable.startedAt), desc(automationRunLogsTable.id))
      .limit(limit);

    return rows.map(mapRunRow);
  }

  async updateRunLog(
    runId: string,
    update: Partial<Pick<AutomationRunLog, 'status' | 'error' | 'finishedAt' | 'taskId'>>
  ): Promise<void> {
    await this.ensureInitialized();
    const { db } = await getDrizzleClient();

    // Drizzle skips undefined values in .set() automatically
    await db
      .update(automationRunLogsTable)
      .set({
        status: update.status,
        error: update.error,
        finishedAt: update.finishedAt,
        taskId: update.taskId,
      })
      .where(eq(automationRunLogsTable.id, runId));
  }

  async setLastRunResult(
    automationId: string,
    result: 'success' | 'failure',
    error?: string
  ): Promise<void> {
    await this.ensureInitialized();
    const { db } = await getDrizzleClient();

    await db
      .update(automationsTable)
      .set({
        lastRunResult: result,
        lastRunError: error ?? null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(automationsTable.id, automationId));
  }

  async createManualRunLog(automationId: string): Promise<string> {
    const runLogId = generateId();
    const nowIso = new Date().toISOString();

    await dataMutex.run(async () => {
      await this.ensureInitialized();
      const { db } = await getDrizzleClient();

      await this.insertRunLog({
        id: runLogId,
        automationId,
        startedAt: nowIso,
        finishedAt: null,
        status: 'running',
        error: null,
        taskId: null,
      });

      const rows = await db
        .select({ runCount: automationsTable.runCount })
        .from(automationsTable)
        .where(eq(automationsTable.id, automationId))
        .limit(1);

      if (rows[0]) {
        await db
          .update(automationsTable)
          .set({
            runCount: rows[0].runCount + 1,
            lastRunAt: nowIso,
            updatedAt: nowIso,
          })
          .where(eq(automationsTable.id, automationId));
      }
    });

    return runLogId;
  }

  /**
   * Reconcile state after an app restart:
   * 1. Recalculate nextRunAt for any active automations whose scheduled time has passed.
   * 2. Mark orphaned "running" run logs as failed (app was closed or run timed out).
   *
   * All operations are performed under a single dataMutex lock to prevent
   * interleaving with concurrent ticks or manual triggers.
   */
  /**
   * Reconcile state after an app restart:
   * 1. Mark orphaned "running" run logs as failed (app was closed or timed out).
   * 2. Catch-up: trigger missed automations exactly once each, regardless of
   *    how many scheduled occurrences were skipped while the app was closed.
   * 3. Recalculate nextRunAt to the next future occurrence.
   *
   * Triggers are collected under the mutex and fired afterwards so that
   * callbacks never run while the lock is held.
   */
  async reconcileMissedRuns(): Promise<void> {
    const triggers: Array<{ automation: Automation; runLogId: string }> = [];

    await dataMutex.run(async () => {
      await this.ensureInitialized();
      const { db } = await getDrizzleClient();
      const now = new Date();
      const nowIso = now.toISOString();

      // Phase 1: Mark orphaned "running" run logs as interrupted/timed-out
      const runningRows = await db
        .select()
        .from(automationRunLogsTable)
        .where(eq(automationRunLogsTable.status, 'running'));

      const affectedAutomationErrors = new Map<string, string>();

      for (const row of runningRows) {
        const startedAt = new Date(row.startedAt);
        const elapsed = now.getTime() - startedAt.getTime();

        const nextError =
          elapsed > DEFAULT_MAX_RUN_DURATION_MS
            ? `Run timed out after ${Math.round(elapsed / 60_000)} minutes`
            : 'Interrupted (app was closed or crashed)';

        await db
          .update(automationRunLogsTable)
          .set({
            status: 'failure',
            error: nextError,
            finishedAt: nowIso,
          })
          .where(eq(automationRunLogsTable.id, row.id));

        const existingError = affectedAutomationErrors.get(row.automationId);
        if (!existingError || nextError.startsWith('Run timed out after')) {
          affectedAutomationErrors.set(row.automationId, nextError);
        }
      }

      // Phase 2: Update parent automations for interrupted runs
      if (affectedAutomationErrors.size > 0) {
        for (const [automationId, lastRunError] of affectedAutomationErrors) {
          await db
            .update(automationsTable)
            .set({
              lastRunResult: 'failure',
              lastRunError,
              updatedAt: nowIso,
            })
            .where(eq(automationsTable.id, automationId));
        }
      }

      // Phase 3: Catch-up missed schedules — trigger each once, then advance nextRunAt
      const dueRows = await db
        .select()
        .from(automationsTable)
        .where(and(eq(automationsTable.status, 'active'), lte(automationsTable.nextRunAt, nowIso)));

      for (const row of dueRows) {
        const automation = mapAutomationRow(row);
        if (!automation.nextRunAt) continue;

        const nextRun = new Date(automation.nextRunAt);
        if (nextRun >= now) continue;

        const runLogId = generateId();
        const recalculatedNextRun = computeNextRun(automation.schedule, now);
        const nextRunCount = automation.runCount + 1;

        await db
          .update(automationsTable)
          .set({
            lastRunAt: nowIso,
            runCount: nextRunCount,
            nextRunAt: recalculatedNextRun,
            updatedAt: nowIso,
          })
          .where(eq(automationsTable.id, automation.id));

        await this.insertRunLog({
          id: runLogId,
          automationId: automation.id,
          startedAt: nowIso,
          finishedAt: null,
          status: 'running',
          error: null,
          taskId: null,
        });

        triggers.push({
          automation: {
            ...automation,
            lastRunAt: nowIso,
            runCount: nextRunCount,
            nextRunAt: recalculatedNextRun,
            updatedAt: nowIso,
          },
          runLogId,
        });

        log.info(
          `[Automations] Catch-up trigger for "${automation.name}" (missed while app was closed) — next run: ${recalculatedNextRun}`
        );
      }
    });

    // Fire trigger callbacks outside the mutex
    for (const { automation, runLogId } of triggers) {
      for (const cb of this.triggerCallbacks) {
        try {
          cb(automation, runLogId);
        } catch (err) {
          log.error(`[Automations] Catch-up trigger callback failed for ${automation.id}:`, err);
          await this.setLastRunResult(
            automation.id,
            'failure',
            err instanceof Error ? err.message : String(err)
          );
        }
      }
    }
  }
}

export const automationsService = new AutomationsService();
