import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { log } from '../lib/logger';
import type {
  Automation,
  AutomationRunLog,
  AutomationSchedule,
  CreateAutomationInput,
  UpdateAutomationInput,
  DayOfWeek,
  ScheduleType,
} from '../../shared/automations/types';

// ---------------------------------------------------------------------------
// Persistence — flat JSON file in the app's userData directory
// ---------------------------------------------------------------------------
function getDataPath(): string {
  return path.join(app.getPath('userData'), 'automations.json');
}

function getRunLogPath(): string {
  return path.join(app.getPath('userData'), 'automation-runs.json');
}

interface AutomationsData {
  automations: Automation[];
}

interface RunLogsData {
  runs: AutomationRunLog[];
}

// ---------------------------------------------------------------------------
// Async file I/O with serialized access to prevent race conditions
// ---------------------------------------------------------------------------

/** Simple async mutex — serializes read-modify-write cycles */
class AsyncMutex {
  private chain: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    let result!: T;
    this.chain = this.chain
      .then(async () => {
        result = await fn();
      })
      .catch(() => {
        /* errors propagate via the returned promise, not the chain */
      });
    // Wait for our slot in the chain
    const ourSlot = this.chain;
    await ourSlot;
    return result;
  }
}

const dataMutex = new AsyncMutex();
const runLogMutex = new AsyncMutex();

async function readData(): Promise<AutomationsData> {
  try {
    const raw = await fs.readFile(getDataPath(), 'utf-8');
    return JSON.parse(raw) as AutomationsData;
  } catch {
    return { automations: [] };
  }
}

async function writeData(data: AutomationsData): Promise<void> {
  const filePath = getDataPath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  // Atomic write: write to tmp then rename
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, filePath);
}

async function readRunLogs(): Promise<RunLogsData> {
  try {
    const raw = await fs.readFile(getRunLogPath(), 'utf-8');
    return JSON.parse(raw) as RunLogsData;
  } catch {
    return { runs: [] };
  }
}

async function writeRunLogs(data: RunLogsData): Promise<void> {
  const filePath = getRunLogPath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Schedule helpers
// ---------------------------------------------------------------------------
const DAY_ORDER: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const VALID_SCHEDULE_TYPES: ScheduleType[] = ['hourly', 'daily', 'weekly', 'monthly'];
const VALID_DAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Validate schedule input and throw on invalid values */
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
  if (
    schedule.type === 'weekly' &&
    schedule.dayOfWeek &&
    !VALID_DAYS.includes(schedule.dayOfWeek)
  ) {
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
      // Clamp to the last day of the target month to avoid overflow
      const daysInCurrentMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      const targetDom = Math.min(desiredDom, daysInCurrentMonth);
      next.setDate(targetDom);
      next.setHours(hour, minute, 0, 0);
      if (next <= now) {
        // Move to next month, re-clamp
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

// ---------------------------------------------------------------------------
// Scheduler — runs a timer to check for due automations
// ---------------------------------------------------------------------------

type AutomationTriggerCallback = (automation: Automation, runLogId: string) => void;

const MAX_RUNS_PER_AUTOMATION = 100;

class AutomationsService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private triggerCallbacks: AutomationTriggerCallback[] = [];
  private ticking = false;

  /** Register a callback that gets called when an automation is due */
  onTrigger(cb: AutomationTriggerCallback): void {
    this.triggerCallbacks.push(cb);
  }

  /** Start the scheduler — checks every 30 seconds */
  start(): void {
    if (this.timer) return;
    log.info('[Automations] Scheduler started');
    this.timer = setInterval(() => void this.tick(), 30_000);
    // Run immediately on start (also handles missed runs)
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info('[Automations] Scheduler stopped');
    }
  }

  private async tick(): Promise<void> {
    // Prevent overlapping ticks
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
    // Collect triggers to fire after releasing the data lock
    const triggers: Array<{ automation: Automation; runLogId: string }> = [];

    await dataMutex.run(async () => {
      const data = await readData();
      const now = new Date();

      let changed = false;
      for (const automation of data.automations) {
        if (automation.status !== 'active') continue;
        if (!automation.nextRunAt) continue;

        const nextRun = new Date(automation.nextRunAt);
        if (nextRun <= now) {
          log.info(`[Automations] Triggering automation: ${automation.name} (${automation.id})`);

          // Update run info
          automation.lastRunAt = now.toISOString();
          automation.runCount += 1;
          automation.nextRunAt = computeNextRun(automation.schedule, now);
          changed = true;

          // Record run log
          const runLogId = generateId();
          await runLogMutex.run(async () => {
            await this.createRunLogInternal({
              id: runLogId,
              automationId: automation.id,
              startedAt: now.toISOString(),
              finishedAt: null,
              status: 'running',
              error: null,
              taskId: null,
            });
          });

          triggers.push({ automation: { ...automation }, runLogId });
        }
      }

      if (changed) {
        await writeData(data);
      }
    });

    // Fire callbacks outside the lock to prevent deadlocks
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

  // ---------------------------------------------------------------------------
  // Run log management
  // ---------------------------------------------------------------------------

  /** Internal — must be called inside runLogMutex.run() */
  private async createRunLogInternal(runLog: AutomationRunLog): Promise<void> {
    const logs = await readRunLogs();
    logs.runs.push(runLog);

    // Prune old runs for this automation
    const automationRuns = logs.runs.filter((r) => r.automationId === runLog.automationId);
    if (automationRuns.length > MAX_RUNS_PER_AUTOMATION) {
      const idsToRemove = new Set(
        automationRuns.slice(0, automationRuns.length - MAX_RUNS_PER_AUTOMATION).map((r) => r.id)
      );
      logs.runs = logs.runs.filter((r) => !idsToRemove.has(r.id));
    }

    await writeRunLogs(logs);
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async list(): Promise<Automation[]> {
    return (await readData()).automations;
  }

  async get(id: string): Promise<Automation | null> {
    const data = await readData();
    return data.automations.find((a) => a.id === id) ?? null;
  }

  async create(input: CreateAutomationInput): Promise<Automation> {
    validateSchedule(input.schedule);

    return dataMutex.run(async () => {
      const data = await readData();
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
      data.automations.push(automation);
      await writeData(data);
      log.info(`[Automations] Created automation: ${automation.name} (${automation.id})`);
      return automation;
    });
  }

  async update(input: UpdateAutomationInput): Promise<Automation | null> {
    if (input.schedule) {
      validateSchedule(input.schedule);
    }

    return dataMutex.run(async () => {
      const data = await readData();
      const idx = data.automations.findIndex((a) => a.id === input.id);
      if (idx === -1) return null;

      const automation = data.automations[idx];
      if (input.name !== undefined) automation.name = input.name;
      if (input.prompt !== undefined) automation.prompt = input.prompt;
      if (input.agentId !== undefined) automation.agentId = input.agentId;
      if (input.status !== undefined) automation.status = input.status;
      if (input.useWorktree !== undefined) automation.useWorktree = input.useWorktree;
      if (input.schedule !== undefined) {
        automation.schedule = input.schedule;
        automation.nextRunAt = computeNextRun(input.schedule);
      }
      automation.updatedAt = new Date().toISOString();

      data.automations[idx] = automation;
      await writeData(data);
      log.info(`[Automations] Updated automation: ${automation.name} (${automation.id})`);
      return automation;
    });
  }

  async delete(id: string): Promise<boolean> {
    return dataMutex.run(async () => {
      const data = await readData();
      const before = data.automations.length;
      data.automations = data.automations.filter((a) => a.id !== id);
      if (data.automations.length === before) return false;
      await writeData(data);

      // Also clean up run logs
      await runLogMutex.run(async () => {
        const logs = await readRunLogs();
        logs.runs = logs.runs.filter((r) => r.automationId !== id);
        await writeRunLogs(logs);
      });

      log.info(`[Automations] Deleted automation: ${id}`);
      return true;
    });
  }

  async toggleStatus(id: string): Promise<Automation | null> {
    return dataMutex.run(async () => {
      const data = await readData();
      const automation = data.automations.find((a) => a.id === id);
      if (!automation) return null;

      automation.status = automation.status === 'active' ? 'paused' : 'active';
      if (automation.status === 'active') {
        automation.nextRunAt = computeNextRun(automation.schedule);
        // Clear any stale error state when re-activating
        automation.lastRunError = null;
      }
      automation.updatedAt = new Date().toISOString();
      await writeData(data);
      return automation;
    });
  }

  async getRunLogs(automationId: string, limit = 20): Promise<AutomationRunLog[]> {
    return runLogMutex.run(async () => {
      const logs = await readRunLogs();
      return logs.runs
        .filter((r) => r.automationId === automationId)
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
        .slice(0, limit);
    });
  }

  async updateRunLog(
    runId: string,
    update: Partial<Pick<AutomationRunLog, 'status' | 'error' | 'finishedAt' | 'taskId'>>
  ): Promise<void> {
    await runLogMutex.run(async () => {
      const logs = await readRunLogs();
      const run = logs.runs.find((r) => r.id === runId);
      if (run) {
        Object.assign(run, update);
        await writeRunLogs(logs);
      }
    });
  }

  /** Update the last run result on the automation itself */
  async setLastRunResult(
    automationId: string,
    result: 'success' | 'failure',
    error?: string
  ): Promise<void> {
    await dataMutex.run(async () => {
      const data = await readData();
      const automation = data.automations.find((a) => a.id === automationId);
      if (automation) {
        automation.lastRunResult = result;
        automation.lastRunError = error ?? null;
        automation.updatedAt = new Date().toISOString();
        await writeData(data);
      }
    });
  }

  /**
   * Create a run log for a manual trigger ("Run now").
   * Returns the run log ID so the caller can track it.
   *
   * Both the run log creation and automation state update are done
   * atomically (under both mutexes) to prevent a window where the
   * run log exists but the automation's runCount/lastRunAt is stale.
   */
  async createManualRunLog(automationId: string): Promise<string> {
    const runLogId = generateId();
    const now = new Date().toISOString();

    await dataMutex.run(async () => {
      // Create the run log
      await runLogMutex.run(async () => {
        await this.createRunLogInternal({
          id: runLogId,
          automationId,
          startedAt: now,
          finishedAt: null,
          status: 'running',
          error: null,
          taskId: null,
        });
      });

      // Update the automation's run count and lastRunAt while still holding the data lock
      const data = await readData();
      const automation = data.automations.find((a) => a.id === automationId);
      if (automation) {
        automation.runCount += 1;
        automation.lastRunAt = now;
        automation.updatedAt = now;
        await writeData(data);
      }
    });

    return runLogId;
  }

  /**
   * Check for automations whose nextRunAt is in the past (missed while app was closed).
   * Recalculates nextRunAt to the next future occurrence without triggering missed runs.
   */
  async reconcileMissedRuns(): Promise<void> {
    await dataMutex.run(async () => {
      const data = await readData();
      const now = new Date();
      let changed = false;

      for (const automation of data.automations) {
        if (automation.status !== 'active') continue;
        if (!automation.nextRunAt) continue;

        const nextRun = new Date(automation.nextRunAt);
        if (nextRun < now) {
          // The scheduled time is in the past — recalculate to next future occurrence
          automation.nextRunAt = computeNextRun(automation.schedule, now);
          changed = true;
          log.info(
            `[Automations] Reconciled missed run for "${automation.name}" — next run: ${automation.nextRunAt}`
          );
        }
      }

      if (changed) {
        await writeData(data);
      }
    });
  }
}

export const automationsService = new AutomationsService();
