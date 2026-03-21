import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../lib/logger';
import type {
  Automation,
  AutomationRunLog,
  AutomationSchedule,
  CreateAutomationInput,
  UpdateAutomationInput,
  DayOfWeek,
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

function readData(): AutomationsData {
  try {
    const raw = fs.readFileSync(getDataPath(), 'utf-8');
    return JSON.parse(raw) as AutomationsData;
  } catch {
    return { automations: [] };
  }
}

function writeData(data: AutomationsData): void {
  const dir = path.dirname(getDataPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getDataPath(), JSON.stringify(data, null, 2), 'utf-8');
}

function readRunLogs(): RunLogsData {
  try {
    const raw = fs.readFileSync(getRunLogPath(), 'utf-8');
    return JSON.parse(raw) as RunLogsData;
  } catch {
    return { runs: [] };
  }
}

function writeRunLogs(data: RunLogsData): void {
  const dir = path.dirname(getRunLogPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getRunLogPath(), JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Schedule helpers
// ---------------------------------------------------------------------------
const DAY_ORDER: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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
      const targetDom = schedule.dayOfMonth ?? 1;
      next.setDate(targetDom);
      next.setHours(hour, minute, 0, 0);
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
        next.setDate(targetDom);
        next.setHours(hour, minute, 0, 0);
      }
      break;
    }
    case 'custom': {
      // For custom cron, fall back to next hour
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      break;
    }
  }

  return next.toISOString();
}

function generateId(): string {
  return `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Scheduler — runs a timer to check for due automations
// ---------------------------------------------------------------------------

type AutomationTriggerCallback = (automation: Automation) => void;

class AutomationsService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private triggerCallback: AutomationTriggerCallback | null = null;

  /** Register a callback that gets called when an automation is due */
  onTrigger(cb: AutomationTriggerCallback): void {
    this.triggerCallback = cb;
  }

  /** Start the scheduler — checks every 30 seconds */
  start(): void {
    if (this.timer) return;
    log.info('[Automations] Scheduler started');
    this.timer = setInterval(() => this.tick(), 30_000);
    // Run immediately on start
    this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info('[Automations] Scheduler stopped');
    }
  }

  private tick(): void {
    const data = readData();
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
        const runLog: AutomationRunLog = {
          id: generateId(),
          automationId: automation.id,
          startedAt: now.toISOString(),
          finishedAt: null,
          status: 'running',
          error: null,
          taskId: null,
        };
        const logs = readRunLogs();
        logs.runs.push(runLog);
        // Keep only last 100 runs per automation
        const automationRuns = logs.runs.filter((r) => r.automationId === automation.id);
        if (automationRuns.length > 100) {
          const idsToRemove = new Set(
            automationRuns.slice(0, automationRuns.length - 100).map((r) => r.id)
          );
          logs.runs = logs.runs.filter((r) => !idsToRemove.has(r.id));
        }
        writeRunLogs(logs);

        // Trigger the callback
        if (this.triggerCallback) {
          try {
            this.triggerCallback(automation);
          } catch (err) {
            log.error(`[Automations] Trigger callback failed for ${automation.id}:`, err);
            automation.lastRunResult = 'failure';
            automation.lastRunError = err instanceof Error ? err.message : String(err);
          }
        }
      }
    }

    if (changed) {
      writeData(data);
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async list(): Promise<Automation[]> {
    return readData().automations;
  }

  async get(id: string): Promise<Automation | null> {
    const data = readData();
    return data.automations.find((a) => a.id === id) ?? null;
  }

  async create(input: CreateAutomationInput): Promise<Automation> {
    const data = readData();
    const now = new Date().toISOString();
    const automation: Automation = {
      id: generateId(),
      name: input.name,
      projectId: input.projectId,
      projectName: '', // Will be set by the caller
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
    writeData(data);
    log.info(`[Automations] Created automation: ${automation.name} (${automation.id})`);
    return automation;
  }

  async update(input: UpdateAutomationInput): Promise<Automation | null> {
    const data = readData();
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
    writeData(data);
    log.info(`[Automations] Updated automation: ${automation.name} (${automation.id})`);
    return automation;
  }

  async delete(id: string): Promise<boolean> {
    const data = readData();
    const before = data.automations.length;
    data.automations = data.automations.filter((a) => a.id !== id);
    if (data.automations.length === before) return false;
    writeData(data);

    // Also clean up run logs
    const logs = readRunLogs();
    logs.runs = logs.runs.filter((r) => r.automationId !== id);
    writeRunLogs(logs);

    log.info(`[Automations] Deleted automation: ${id}`);
    return true;
  }

  async toggleStatus(id: string): Promise<Automation | null> {
    const data = readData();
    const automation = data.automations.find((a) => a.id === id);
    if (!automation) return null;

    automation.status = automation.status === 'active' ? 'paused' : 'active';
    if (automation.status === 'active') {
      automation.nextRunAt = computeNextRun(automation.schedule);
    }
    automation.updatedAt = new Date().toISOString();
    writeData(data);
    return automation;
  }

  async getRunLogs(automationId: string, limit = 20): Promise<AutomationRunLog[]> {
    const logs = readRunLogs();
    return logs.runs
      .filter((r) => r.automationId === automationId)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limit);
  }

  async updateRunLog(
    runId: string,
    update: Partial<Pick<AutomationRunLog, 'status' | 'error' | 'finishedAt' | 'taskId'>>
  ): Promise<void> {
    const logs = readRunLogs();
    const run = logs.runs.find((r) => r.id === runId);
    if (run) {
      Object.assign(run, update);
      writeRunLogs(logs);
    }
  }

  /** Set the project name on an automation (called after creation) */
  async setProjectName(automationId: string, projectName: string): Promise<void> {
    const data = readData();
    const automation = data.automations.find((a) => a.id === automationId);
    if (automation) {
      automation.projectName = projectName;
      writeData(data);
    }
  }

  /** Update the last run result on the automation itself */
  async setLastRunResult(
    automationId: string,
    result: 'success' | 'failure',
    error?: string
  ): Promise<void> {
    const data = readData();
    const automation = data.automations.find((a) => a.id === automationId);
    if (automation) {
      automation.lastRunResult = result;
      automation.lastRunError = error ?? null;
      automation.updatedAt = new Date().toISOString();
      writeData(data);
    }
  }
}

export const automationsService = new AutomationsService();
