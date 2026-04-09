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
  AutomationMode,
  AutomationRunLog,
  AutomationSchedule,
  CreateAutomationInput,
  DayOfWeek,
  ScheduleType,
  TriggerConfig,
  TriggerType,
  UpdateAutomationInput,
} from '../../shared/automations/types';

import { TRIGGER_INTEGRATION_MAP } from '../../shared/automations/types';

// ---------------------------------------------------------------------------
// Shared event shape returned by all fetch*() methods
// ---------------------------------------------------------------------------

interface RawEvent {
  id: string;
  title: string;
  url?: string;
  type: string;
  extra?: string;
  labels?: string[];
  branch?: string;
  assignee?: string;
}

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

function deserializeTriggerConfig(serialized: string | null): TriggerConfig | null {
  if (!serialized) return null;
  try {
    return JSON.parse(serialized) as TriggerConfig;
  } catch {
    return null;
  }
}

function serializeTriggerConfig(config: TriggerConfig | null | undefined): string | null {
  if (!config) return null;
  return JSON.stringify(config);
}

function normalizeMode(value: unknown): AutomationMode {
  if (value === 'trigger') return 'trigger';
  return 'schedule';
}

function normalizeTriggerType(value: unknown): TriggerType | null {
  if (typeof value === 'string' && value in TRIGGER_INTEGRATION_MAP) {
    return value as TriggerType;
  }
  return null;
}

function mapAutomationRow(row: AutomationRow): Automation {
  return {
    id: row.id,
    name: row.name,
    projectId: row.projectId,
    projectName: row.projectName,
    prompt: row.prompt,
    agentId: row.agentId,
    mode: normalizeMode(row.mode),
    schedule: deserializeSchedule(row.schedule),
    triggerType: normalizeTriggerType(row.triggerType),
    triggerConfig: deserializeTriggerConfig(row.triggerConfig),
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
type ReconcileMode = 'startup' | 'resume';

class AutomationsService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private triggerTimer: ReturnType<typeof setInterval> | null = null;
  private triggerCallbacks: AutomationTriggerCallback[] = [];
  private ticking = false;
  private triggerTicking = false;
  private reconciling = false;
  private initialized = false;

  /** Tracks the last-known event IDs per automation to detect new ones */
  private knownEventIds = new Map<string, Set<string>>();

  /** Tracks automations with an in-flight (running) run to prevent overlap */
  private inFlightRuns = new Set<string>();

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
    this.triggerTicking = false;
    this.reconciling = false;
    this.knownEventIds.clear();
    this.inFlightRuns.clear();
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

    // Trigger polling every 10s. This is safe because:
    // 1. GitHub Events API with ETag caching → 304 responses when nothing changed (nearly free)
    // 2. Fetch results are deduplicated per project+triggerType within each cycle
    // 3. GitHub's Events API recommends X-Poll-Interval of ~10s
    if (!this.triggerTimer) {
      this.triggerTimer = setInterval(() => void this.tickTriggers(), 10_000);
      // First trigger poll after a short delay to let integrations initialize
      setTimeout(() => void this.tickTriggers(), 2_000);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.triggerTimer) {
      clearInterval(this.triggerTimer);
      this.triggerTimer = null;
    }
    log.info('[Automations] Scheduler stopped');
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

        // Skip if a previous run is still in-flight to prevent overlap
        if (this.inFlightRuns.has(automation.id)) continue;

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

        this.inFlightRuns.add(automation.id);

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
  // Event-trigger polling
  // -------------------------------------------------------------------

  private async tickTriggers(): Promise<void> {
    if (this.triggerTicking) return;
    this.triggerTicking = true;
    try {
      await this.executeTriggerPoll();
    } catch (err) {
      log.error('[Automations] Trigger poll failed:', err);
    } finally {
      this.triggerTicking = false;
    }
  }

  private async executeTriggerPoll(): Promise<void> {
    // Read active trigger automations under mutex to avoid TOCTOU with deletes/updates
    const activeAutomations: Automation[] = await dataMutex.run(async () => {
      await this.ensureInitialized();
      const { db } = await getDrizzleClient();
      const rows = await db
        .select()
        .from(automationsTable)
        .where(and(eq(automationsTable.status, 'active'), eq(automationsTable.mode, 'trigger')));
      return rows.map(mapAutomationRow);
    });

    if (activeAutomations.length === 0) return;

    // Per-cycle fetch cache: avoids duplicate API calls when multiple automations
    // watch the same project+triggerType (e.g. 5 automations on the same repo).
    const fetchCache = new Map<string, Promise<RawEvent[]>>();

    const triggers: Array<{ automation: Automation; runLogId: string }> = [];

    for (const automation of activeAutomations) {
      if (!automation.triggerType) continue;

      try {
        const newEvents = await this.fetchNewEventsCached(automation, fetchCache);
        if (newEvents.length === 0) continue;

        for (const event of newEvents) {
          const runLogId = generateId();
          const nowIso = new Date().toISOString();

          await dataMutex.run(async () => {
            const { db: freshDb } = await getDrizzleClient();
            await freshDb
              .update(automationsTable)
              .set({
                lastRunAt: nowIso,
                runCount: sql`${automationsTable.runCount} + 1`,
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
          });

          const enrichedPrompt = this.enrichPromptWithEvent(automation.prompt, event);
          triggers.push({
            automation: {
              ...automation,
              prompt: enrichedPrompt,
              lastRunAt: new Date().toISOString(),
              runCount: automation.runCount + 1,
            },
            runLogId,
          });
        }
      } catch (err) {
        log.error(`[Automations] Trigger poll failed for "${automation.name}":`, err);
        await this.setLastRunResult(
          automation.id,
          'failure',
          err instanceof Error ? err.message : String(err)
        );
      }
    }

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

  private enrichPromptWithEvent(
    basePrompt: string,
    event: Pick<RawEvent, 'id' | 'title' | 'url' | 'type' | 'extra'>
  ): string {
    const contextLines: string[] = [];
    contextLines.push(`[Triggered by ${event.type}: "${event.title}"]`);
    if (event.url) contextLines.push(`URL: ${event.url}`);
    if (event.extra) contextLines.push(event.extra);
    return `${contextLines.join('\n')}\n\n${basePrompt}`;
  }

  /**
   * Fetch new events for an automation, using a per-cycle cache to deduplicate
   * API calls when multiple automations watch the same project + trigger type.
   */
  private async fetchNewEventsCached(
    automation: Automation,
    cache: Map<string, Promise<RawEvent[]>>
  ): Promise<RawEvent[]> {
    const known = this.knownEventIds.get(automation.id) ?? new Set<string>();
    const newEvents: RawEvent[] = [];

    try {
      const cacheKey = `${automation.projectId}::${automation.triggerType}`;
      let eventsPromise = cache.get(cacheKey);
      if (!eventsPromise) {
        eventsPromise = this.fetchRawEvents(automation);
        cache.set(cacheKey, eventsPromise);
      }
      const rawEvents = await eventsPromise;

      if (!this.knownEventIds.has(automation.id)) {
        // First poll: seed the known set without triggering
        this.knownEventIds.set(automation.id, new Set(rawEvents.map((e) => e.id)));
        log.info(
          `[Automations] Seeded ${rawEvents.length} known events for "${automation.name}" (${automation.triggerType})`
        );
        return [];
      }

      for (const event of rawEvents) {
        if (!known.has(event.id)) {
          if (this.matchesTriggerFilters(event, automation.triggerConfig)) {
            newEvents.push(event);
          }
          known.add(event.id);
        }
      }

      // Cap the known set to prevent memory bloat
      if (known.size > 5000) {
        const entries = Array.from(known);
        const toRemove = entries.slice(0, entries.length - 2000);
        for (const id of toRemove) known.delete(id);
      }

      this.knownEventIds.set(automation.id, known);
    } catch (err) {
      log.error(`[Automations] fetchNewEvents failed for "${automation.name}":`, err);
    }

    return newEvents;
  }

  private matchesTriggerFilters(event: RawEvent, config: TriggerConfig | null): boolean {
    if (!config) return true;

    if (config.labelFilter && config.labelFilter.length > 0) {
      if (!event.labels || event.labels.length === 0) return false;
      const hasMatchingLabel = config.labelFilter.some((f) =>
        event.labels!.some((l) => l.toLowerCase() === f.toLowerCase())
      );
      if (!hasMatchingLabel) return false;
    }

    if (config.branchFilter) {
      if (!event.branch) return false;
      const pattern = config.branchFilter;
      if (pattern.includes('*')) {
        // Escape regex special chars, then convert glob * to .*
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        const regex = new RegExp('^' + escaped + '$');
        if (!regex.test(event.branch)) return false;
      } else {
        if (event.branch !== pattern) return false;
      }
    }

    if (config.assigneeFilter) {
      if (!event.assignee) return false;
      if (event.assignee.toLowerCase() !== config.assigneeFilter.toLowerCase()) return false;
    }

    return true;
  }

  private async fetchRawEvents(automation: Automation): Promise<RawEvent[]> {
    if (!automation.triggerType) return [];

    // Resolve project path (needed for GitHub, GitLab, Forgejo)
    const { databaseService } = await import('./DatabaseService');
    const projects = await databaseService.getProjects();
    const project = projects.find((p) => p.id === automation.projectId);
    const projectPath = project?.path;

    try {
      switch (automation.triggerType) {
        case 'github_pr':
          return await this.fetchGitHubEvents(projectPath, 'PullRequestEvent');
        case 'github_issue':
          return await this.fetchGitHubEvents(projectPath, 'IssuesEvent');
        case 'linear_issue':
          return await this.fetchLinearEvents();
        case 'jira_issue':
          return await this.fetchJiraEvents();
        case 'gitlab_issue':
          return await this.fetchGitLabEvents(projectPath, 'issue');
        case 'gitlab_mr':
          return await this.fetchGitLabEvents(projectPath, 'mr');
        case 'forgejo_issue':
          return await this.fetchForgejoEvents(projectPath);
        case 'plain_thread':
          return await this.fetchPlainEvents();
        case 'sentry_issue':
          return await this.fetchSentryEvents();
        default:
          return [];
      }
    } catch (err) {
      const integration = TRIGGER_INTEGRATION_MAP[automation.triggerType];
      log.error(`[Automations] Fetch failed for "${automation.name}" (${integration}):`, err);
      return [];
    }
  }

  // -------------------------------------------------------------------
  // Per-integration event fetchers — each checks connection first
  // -------------------------------------------------------------------

  private async fetchGitHubEvents(
    projectPath: string | undefined,
    eventType: 'IssuesEvent' | 'PullRequestEvent'
  ): Promise<RawEvent[]> {
    if (!projectPath) return [];
    const { githubService: gh } = await import('./GitHubService');
    if (!(await gh.isAuthenticated())) return [];

    const repoEvents = await gh.fetchRepoEvents(projectPath, [eventType]);
    return repoEvents.map((event) => ({
      id: event.id,
      title: event.title,
      url: event.url,
      type: eventType === 'IssuesEvent' ? 'GitHub Issue' : 'GitHub PR',
      extra: `${eventType === 'IssuesEvent' ? 'Issue' : 'PR'} #${event.number}`,
      labels: event.labels,
      branch: event.branch,
      assignee: event.assignee,
    }));
  }

  private async fetchLinearEvents(): Promise<RawEvent[]> {
    const { default: LinearService } = await import('./LinearService');
    const linear = new LinearService();
    const status = await linear.checkConnection();
    if (!status.connected) return [];

    const issues = await linear.initialFetch(30);
    return issues.map((issue: any) => ({
      id: `linear-${issue.id}`,
      title: issue.title ?? '',
      url: issue.url,
      type: 'Linear Issue',
      extra: issue.identifier ? `${issue.identifier}: ${issue.title}` : issue.title,
      assignee: issue.assignee?.displayName ?? issue.assignee?.name ?? undefined,
    }));
  }

  private async fetchJiraEvents(): Promise<RawEvent[]> {
    const JiraService = (await import('./JiraService')).default;
    const jira = new JiraService();
    const status = await jira.checkConnection();
    if (!status.connected) return [];

    const issues = await jira.initialFetch(30);
    return issues.map((issue: any) => ({
      id: `jira-${issue.id ?? issue.key}`,
      title: issue.title ?? issue.summary ?? '',
      url: issue.url ?? issue.self ?? undefined,
      type: 'Jira Issue',
      extra: issue.key ? `${issue.key}: ${issue.title ?? issue.summary}` : (issue.title ?? ''),
      labels: issue.labels,
      assignee: issue.assignee?.displayName ?? issue.assignee?.name ?? undefined,
    }));
  }

  private async fetchGitLabEvents(
    projectPath: string | undefined,
    kind: 'issue' | 'mr'
  ): Promise<RawEvent[]> {
    if (!projectPath) return [];
    const { GitLabService } = await import('./GitLabService');
    const gitlab = new GitLabService();
    const connStatus = await gitlab.checkConnection();
    if (!connStatus.success) return [];

    if (kind === 'issue') {
      const result = await gitlab.initialFetch(projectPath, 30);
      if (!result.success || !result.issues) return [];
      return result.issues.map((issue: any) => ({
        id: `gitlab-issue-${issue.id ?? issue.iid}`,
        title: issue.title ?? '',
        url: issue.web_url ?? undefined,
        type: 'GitLab Issue',
        extra: issue.iid ? `#${issue.iid}: ${issue.title}` : issue.title,
        labels: issue.labels ?? [],
        assignee: issue.assignee?.name ?? issue.assignee?.username ?? undefined,
      }));
    }

    const mrResult = await gitlab.initialFetchMRs(projectPath, 30);
    if (!mrResult.success || !mrResult.mrs) return [];
    return mrResult.mrs.map((mr: any) => ({
      id: `gitlab-mr-${mr.id}`,
      title: mr.title ?? '',
      url: mr.web_url ?? undefined,
      type: 'GitLab MR',
      extra: mr.iid ? `!${mr.iid}: ${mr.title}` : mr.title,
      labels: mr.labels ?? [],
      branch: mr.source_branch ?? undefined,
      assignee: mr.assignee?.name ?? mr.assignee?.username ?? undefined,
    }));
  }

  private async fetchForgejoEvents(projectPath: string | undefined): Promise<RawEvent[]> {
    if (!projectPath) return [];
    const { ForgejoService } = await import('./ForgejoService');
    const forgejo = new ForgejoService();
    const connStatus = await forgejo.checkConnection();
    if (!connStatus.success) return [];

    const result = await forgejo.initialFetch(projectPath, 30);
    if (!result.success || !result.issues) return [];
    return result.issues.map((issue: any) => ({
      id: `forgejo-${issue.id ?? issue.number}`,
      title: issue.title ?? '',
      url: issue.html_url ?? issue.url ?? undefined,
      type: 'Forgejo Issue',
      extra: issue.number ? `#${issue.number}: ${issue.title}` : issue.title,
      labels: issue.labels?.map((l: any) => l?.name ?? l).filter(Boolean) ?? [],
      assignee: issue.assignee?.login ?? issue.assignee?.username ?? undefined,
    }));
  }

  private async fetchPlainEvents(): Promise<RawEvent[]> {
    const { default: PlainService } = await import('./PlainService');
    const plain = new PlainService();
    const status = await plain.checkConnection();
    if (!status.connected) return [];

    const threads = await plain.initialFetch(30);
    return threads.map((thread: any) => ({
      id: `plain-${thread.id}`,
      title: thread.title ?? thread.subject ?? '',
      url: thread.url ?? undefined,
      type: 'Plain Thread',
      extra: thread.title ?? thread.subject ?? '',
      assignee: thread.assignee?.name ?? thread.assignee?.email ?? undefined,
    }));
  }

  private async fetchSentryEvents(): Promise<RawEvent[]> {
    const { sentryService } = await import('./SentryService');

    let issues: import('./SentryService').SentryIssue[];
    try {
      issues = await sentryService.initialFetch(30);
    } catch {
      return [];
    }
    return issues.map((issue) => ({
      id: `sentry-${issue.id}`,
      title: issue.title ?? '',
      url: issue.permalink ?? undefined,
      type: 'Sentry Issue',
      extra: issue.shortId
        ? `${issue.shortId}: ${issue.title}${issue.culprit ? ` in ${issue.culprit}` : ''}`
        : issue.title,
      labels: issue.level ? [issue.level] : undefined,
      assignee: issue.assignedTo?.name ?? issue.assignedTo?.email ?? undefined,
    }));
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
    const mode: AutomationMode = input.mode ?? 'schedule';
    if (mode === 'schedule') {
      validateSchedule(input.schedule);
    }
    if (mode === 'trigger' && !input.triggerType) {
      throw new Error('triggerType is required when mode is "trigger"');
    }
    await this.ensureInitialized();

    const now = new Date().toISOString();
    const isTrigger = mode === 'trigger';
    const automation: Automation = {
      id: generateId(),
      name: input.name,
      projectId: input.projectId,
      projectName: input.projectName ?? '',
      prompt: input.prompt,
      agentId: input.agentId,
      mode,
      schedule: input.schedule,
      triggerType: isTrigger ? (input.triggerType ?? null) : null,
      triggerConfig: isTrigger ? (input.triggerConfig ?? null) : null,
      useWorktree: input.useWorktree ?? true,
      status: 'active',
      lastRunAt: null,
      nextRunAt: isTrigger ? null : computeNextRun(input.schedule),
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
      mode: automation.mode,
      schedule: serializeSchedule(automation.schedule),
      triggerType: automation.triggerType,
      triggerConfig: serializeTriggerConfig(automation.triggerConfig),
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

    // For trigger-based automations, immediately seed known events so the next
    // poll cycle can detect new events right away (instead of wasting a cycle on seeding).
    if (isTrigger) {
      void this.seedAutomationEvents(automation);
    }

    return automation;
  }

  /**
   * Pre-seed known events for a trigger automation so the very next poll
   * cycle can detect genuinely new events instead of treating everything as "first seen".
   */
  private async seedAutomationEvents(automation: Automation): Promise<void> {
    try {
      const rawEvents = await this.fetchRawEvents(automation);
      this.knownEventIds.set(automation.id, new Set(rawEvents.map((e) => e.id)));
      log.info(
        `[Automations] Pre-seeded ${rawEvents.length} events for "${automation.name}" (${automation.triggerType})`
      );
    } catch (err) {
      log.warn(`[Automations] Failed to pre-seed events for "${automation.name}":`, err);
    }
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
    const nextMode = input.mode ?? current.mode;
    const nextSchedule = input.schedule ?? current.schedule;
    const nextUpdatedAt = new Date().toISOString();
    const isTrigger = nextMode === 'trigger';

    const updated: Automation = {
      ...current,
      name: input.name ?? current.name,
      projectId: input.projectId ?? current.projectId,
      projectName: input.projectName ?? current.projectName,
      prompt: input.prompt ?? current.prompt,
      agentId: input.agentId ?? current.agentId,
      mode: nextMode,
      status: input.status ?? current.status,
      useWorktree: input.useWorktree ?? current.useWorktree,
      schedule: nextSchedule,
      triggerType:
        input.triggerType !== undefined
          ? input.triggerType
          : isTrigger
            ? current.triggerType
            : null,
      triggerConfig:
        input.triggerConfig !== undefined
          ? input.triggerConfig
          : isTrigger
            ? current.triggerConfig
            : null,
      nextRunAt: isTrigger
        ? null
        : input.schedule
          ? computeNextRun(nextSchedule)
          : current.nextRunAt,
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
        mode: updated.mode,
        schedule: serializeSchedule(updated.schedule),
        triggerType: updated.triggerType,
        triggerConfig: serializeTriggerConfig(updated.triggerConfig),
        useWorktree: updated.useWorktree ? 1 : 0,
        status: updated.status,
        nextRunAt: updated.nextRunAt,
        updatedAt: updated.updatedAt,
      })
      .where(eq(automationsTable.id, updated.id));

    log.info(`[Automations] Updated automation: ${updated.name} (${updated.id})`);

    // Re-seed when trigger type changed, automation switched to trigger mode,
    // or the project context changed (so stale events aren't replayed).
    const triggerTypeChanged =
      updated.mode === 'trigger' &&
      (input.triggerType !== undefined || input.mode === 'trigger') &&
      updated.triggerType !== current.triggerType;
    const switchedToTrigger = input.mode === 'trigger' && current.mode !== 'trigger';
    const projectChanged =
      updated.mode === 'trigger' &&
      input.projectId !== undefined &&
      input.projectId !== current.projectId;

    if (triggerTypeChanged || switchedToTrigger || projectChanged) {
      this.knownEventIds.delete(updated.id);
      void this.seedAutomationEvents(updated);
    }

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
    this.knownEventIds.delete(id);
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
        nextStatus === 'active' && automation.mode === 'schedule'
          ? computeNextRun(automation.schedule)
          : automation.mode === 'trigger'
            ? null
            : automation.nextRunAt,
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

    // Re-seed known events when a trigger automation is re-activated so stale
    // issues/PRs created while paused don't fire as false positives.
    if (nextStatus === 'active' && updated.mode === 'trigger') {
      this.knownEventIds.delete(updated.id);
      void this.seedAutomationEvents(updated);
    }

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
    update: Partial<Pick<AutomationRunLog, 'status' | 'error' | 'finishedAt' | 'taskId'>>,
    automationId?: string
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

    // Clear in-flight tracking when the run finishes
    if (automationId && (update.status === 'success' || update.status === 'failure')) {
      this.inFlightRuns.delete(automationId);
    }
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
   * 1. Mark orphaned "running" run logs as failed (app was closed or timed out).
   * 2. Catch-up: trigger missed automations exactly once each, regardless of
   *    how many scheduled occurrences were skipped while the app was closed.
   * 3. Recalculate nextRunAt to the next future occurrence.
   *
   * Triggers are collected under the mutex and fired afterwards so that
   * callbacks never run while the lock is held.
   */
  async reconcileMissedRuns(): Promise<void> {
    await this.reconcileMissedRunsWithMode('startup');
  }

  /**
   * Catch up missed schedules after the machine resumes from sleep.
   *
   * Unlike startup reconciliation, this keeps live in-flight runs intact.
   */
  async reconcileMissedRunsAfterResume(): Promise<void> {
    await this.reconcileMissedRunsWithMode('resume');
  }

  private async reconcileMissedRunsWithMode(mode: ReconcileMode): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;

    try {
      const triggers: Array<{ automation: Automation; runLogId: string }> = [];

      await dataMutex.run(async () => {
        await this.ensureInitialized();
        const { db } = await getDrizzleClient();
        const now = new Date();
        const nowIso = now.toISOString();

        if (mode === 'startup') {
          // Only cleanup orphaned runs on cold start. On resume, a "running" row
          // can still correspond to a live task that was merely suspended.
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

            this.inFlightRuns.delete(row.automationId);

            const existingError = affectedAutomationErrors.get(row.automationId);
            if (!existingError || nextError.startsWith('Run timed out after')) {
              affectedAutomationErrors.set(row.automationId, nextError);
            }
          }

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
        }

        // Catch up missed schedules. Live in-flight runs still block overlap,
        // matching the normal scheduler behavior after resume.
        const dueRows = await db
          .select()
          .from(automationsTable)
          .where(
            and(eq(automationsTable.status, 'active'), lte(automationsTable.nextRunAt, nowIso))
          );

        for (const row of dueRows) {
          const automation = mapAutomationRow(row);
          if (!automation.nextRunAt) continue;
          if (this.inFlightRuns.has(automation.id)) continue;

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

          this.inFlightRuns.add(automation.id);

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
            `[Automations] Catch-up trigger for "${automation.name}" after ${mode} reconciliation — next run: ${recalculatedNextRun}`
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
    } finally {
      this.reconciling = false;
    }
  }
}

export const automationsService = new AutomationsService();
