import { randomUUID } from 'node:crypto';
import { Cron } from 'croner';
import { and, asc, desc, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import {
  automationRuns,
  automations,
  conversations,
  projects,
  tasks,
  type AutomationRow,
  type AutomationRunRow,
} from '@main/db/schema';
import { log } from '@main/lib/logger';
import { isValidProviderId, type AgentProviderId } from '@shared/agent-provider-registry';
import { isValidAction, type TaskCreateAction } from '@shared/automations/actions';
import { getLocalTimeZone } from '@shared/automations/timezone';
import type {
  Automation,
  AutomationDeadlinePolicy,
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTriggerKind,
  AutomationRunWithContext,
  CreateAutomationInput,
  CronTrigger,
  UpdateAutomationPatch,
} from '@shared/automations/types';
import { assertValidCronTrigger, assertValidDeadline } from '@shared/automations/validation';
import type { CreateTaskParams } from '@shared/tasks';

const DEFAULT_TZ = getLocalTimeZone();

function fallbackActions(promptTemplate: string): TaskCreateAction[] {
  const prompt = promptTemplate.trim();
  return prompt ? [{ kind: 'task.create', prompt }] : [];
}

function parseActions(raw: string, promptTemplate: string): TaskCreateAction[] {
  if (!raw || raw === '[]') return fallbackActions(promptTemplate);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return fallbackActions(promptTemplate);
    return parsed.every(isValidAction) ? parsed : fallbackActions(promptTemplate);
  } catch (error) {
    log.warn('automations.repo: failed to parse actions JSON', {
      error: String(error),
    });
    return fallbackActions(promptTemplate);
  }
}

function firstTaskCreatePrompt(actions: TaskCreateAction[]): string {
  return actions[0]?.prompt ?? '';
}

function assertPublishableActions(actions: TaskCreateAction[]): void {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error('actions_required');
  }
  const invalidIndex = actions.findIndex((action) => !isValidAction(action));
  if (invalidIndex >= 0) throw new Error(`action_invalid:${invalidIndex}`);
}

function assertValidAutomationInput(input: {
  trigger: CronTrigger;
  deadlinePolicy: AutomationDeadlinePolicy;
  deadlineMs: number | null;
  isDraft: boolean;
  actions: TaskCreateAction[];
}): void {
  assertValidCronTrigger(input.trigger);
  assertValidDeadline(input.deadlinePolicy, input.deadlineMs);
  if (!input.isDraft) assertPublishableActions(input.actions);
}

function parseTaskConfig(raw: string | null): CreateTaskParams | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as CreateTaskParams;
  } catch (error) {
    log.warn('automations.repo: failed to parse taskConfig JSON', {
      error: String(error),
    });
    return null;
  }
}

function asAgentProviderId(
  value: unknown,
  context: Record<string, string>
): AgentProviderId | null {
  if (value == null) return null;
  if (isValidProviderId(value)) return value;
  log.warn('automations.repo: invalid agent provider for run', {
    ...context,
    value: String(value),
  });
  return null;
}

function automationTaskConfigAgentProvider(
  row: Pick<AutomationRow, 'id' | 'taskConfig'>
): AgentProviderId | null {
  const provider = parseTaskConfig(row.taskConfig)?.initialConversation?.provider;
  return asAgentProviderId(provider, { automationId: row.id });
}

const RUN_STATUSES: ReadonlySet<AutomationRunStatus> = new Set([
  'queued',
  'running',
  'success',
  'failed',
  'skipped',
]);
const RUN_TRIGGER_KINDS: ReadonlySet<AutomationRunTriggerKind> = new Set(['cron', 'manual']);
const DEADLINE_POLICIES: ReadonlySet<AutomationDeadlinePolicy> = new Set([
  'next-interval',
  'fixed',
  'none',
]);

function asRunStatus(value: string, runId: string): AutomationRunStatus {
  if (RUN_STATUSES.has(value as AutomationRunStatus)) return value as AutomationRunStatus;
  log.warn('automations.repo: invalid run status, falling back to failed', {
    runId,
    value,
  });
  return 'failed';
}

function asRunTriggerKind(value: string, runId: string): AutomationRunTriggerKind {
  if (RUN_TRIGGER_KINDS.has(value as AutomationRunTriggerKind)) {
    return value as AutomationRunTriggerKind;
  }
  log.warn('automations.repo: invalid run trigger_kind, falling back to manual', {
    runId,
    value,
  });
  return 'manual';
}

function asDeadlinePolicy(
  value: string | null | undefined,
  automationId: string
): AutomationDeadlinePolicy {
  if (value && DEADLINE_POLICIES.has(value as AutomationDeadlinePolicy)) {
    return value as AutomationDeadlinePolicy;
  }
  if (value) {
    log.warn('automations.repo: invalid deadline_policy, falling back to next-interval', {
      automationId,
      value,
    });
  }
  return 'next-interval';
}

function mapAutomationRow(row: AutomationRow): Automation {
  if (!row.cronExpr) throw new Error(`automation_row_missing_cron_expr:${row.id}`);
  const trigger: CronTrigger = {
    expr: row.cronExpr,
    tz: row.cronTz ?? DEFAULT_TZ,
  };

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    trigger,
    actions: parseActions(row.actions, row.promptTemplate),
    taskConfig: parseTaskConfig(row.taskConfig),
    projectId: row.projectId,
    enabled: row.enabled === 1,
    isDraft: row.isDraft === 1,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    deadlinePolicy: asDeadlinePolicy(row.deadlinePolicy, row.id),
    deadlineMs: row.deadlineMs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAutomationRowSafely(row: AutomationRow): Automation | null {
  try {
    return mapAutomationRow(row);
  } catch (error) {
    log.warn('automations.repo: skipping invalid automation row', {
      automationId: row.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function mapAutomationRows(rows: AutomationRow[]): Automation[] {
  return rows.flatMap((row) => {
    const automation = mapAutomationRowSafely(row);
    return automation ? [automation] : [];
  });
}

function mapAutomationRunRow(row: AutomationRunRow): AutomationRun {
  return {
    id: row.id,
    automationId: row.automationId,
    scheduledAt: row.scheduledAt,
    deadlineAt: row.deadlineAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: asRunStatus(row.status, row.id),
    taskId: row.taskId,
    createdTaskId: row.createdTaskId,
    error: row.error,
    triggerKind: asRunTriggerKind(row.triggerKind, row.id),
    workerId: row.workerId,
  };
}

function runTaskIdForAgentProvider(run: AutomationRun): string | null {
  return run.createdTaskId ?? run.taskId;
}

function shouldUseAutomationProviderFallback(run: AutomationRun): boolean {
  const taskId = runTaskIdForAgentProvider(run);
  if (!taskId) return true;

  // For completed runs, falling back to the automation's current provider is misleading
  // after the automation has been edited. Prefer an unknown icon if the task provider
  // cannot be resolved from the run's created task.
  return run.status === 'queued' || run.status === 'running';
}

async function agentProviderByTaskId(taskIds: string[]): Promise<Map<string, AgentProviderId>> {
  const uniqueTaskIds = [...new Set(taskIds)];
  if (uniqueTaskIds.length === 0) return new Map();

  const rows = await db
    .select({
      taskId: conversations.taskId,
      provider: conversations.provider,
      isInitialConversation: conversations.isInitialConversation,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(inArray(conversations.taskId, uniqueTaskIds));

  const bestByTaskId = new Map<
    string,
    { provider: AgentProviderId; isInitialConversation: boolean; createdAt: string }
  >();
  for (const row of rows) {
    const provider = asAgentProviderId(row.provider, { taskId: row.taskId });
    if (!provider) continue;

    const candidate = {
      provider,
      isInitialConversation: row.isInitialConversation === true,
      createdAt: row.createdAt,
    };
    const existing = bestByTaskId.get(row.taskId);
    if (
      !existing ||
      (candidate.isInitialConversation && !existing.isInitialConversation) ||
      (candidate.isInitialConversation === existing.isInitialConversation &&
        candidate.createdAt < existing.createdAt)
    ) {
      bestByTaskId.set(row.taskId, candidate);
    }
  }

  return new Map(
    [...bestByTaskId.entries()].map(([taskId, candidate]) => [taskId, candidate.provider])
  );
}

async function attachAgentProviders<T extends AutomationRun>(
  runs: T[],
  fallbackProvider: (run: T) => AgentProviderId | null
): Promise<T[]> {
  const taskIds = runs
    .map(runTaskIdForAgentProvider)
    .filter((taskId): taskId is string => taskId != null);
  const providersByTaskId = await agentProviderByTaskId(taskIds);

  return runs.map((run) => {
    const taskId = runTaskIdForAgentProvider(run);
    const provider =
      (taskId ? providersByTaskId.get(taskId) : undefined) ??
      (shouldUseAutomationProviderFallback(run) ? fallbackProvider(run) : null);
    return { ...run, agentProviderId: provider };
  });
}

export function getNextRunAt(
  trigger: CronTrigger,
  from: number | Date = new Date()
): number | null {
  const next = new Cron(trigger.expr, { timezone: trigger.tz || DEFAULT_TZ }).nextRun(
    from instanceof Date ? from : new Date(from)
  );
  return next?.getTime() ?? null;
}

function rowValuesFromTrigger(trigger: CronTrigger) {
  return {
    cronExpr: trigger.expr.trim(),
    cronTz: trigger.tz || DEFAULT_TZ,
    nextRunAt: getNextRunAt(trigger),
  };
}

export async function listAutomations(projectId?: string): Promise<Automation[]> {
  const query = projectId
    ? db.select().from(automations).where(eq(automations.projectId, projectId))
    : db.select().from(automations);
  const rows = await query;
  return mapAutomationRows(rows);
}

export async function getAutomation(id: string): Promise<Automation | null> {
  const [row] = await db.select().from(automations).where(eq(automations.id, id)).limit(1);
  return row ? mapAutomationRowSafely(row) : null;
}

export async function skipQueuedCronRuns(
  automationId: string,
  reason: string
): Promise<AutomationRun[]> {
  const rows = await db
    .update(automationRuns)
    .set({ status: 'skipped', finishedAt: Date.now(), error: reason, workerId: null })
    .where(
      and(
        eq(automationRuns.automationId, automationId),
        eq(automationRuns.status, 'queued'),
        eq(automationRuns.triggerKind, 'cron')
      )
    )
    .returning();

  return rows.map(mapAutomationRunRow);
}

async function projectExists(projectId: string): Promise<boolean> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return rows.length > 0;
}

export async function createAutomation(input: CreateAutomationInput): Promise<Automation> {
  if (!(await projectExists(input.projectId))) {
    throw new Error('project_not_found');
  }

  assertValidAutomationInput({
    trigger: input.trigger,
    deadlinePolicy: input.deadlinePolicy ?? 'next-interval',
    deadlineMs: input.deadlineMs ?? null,
    isDraft: input.isDraft ?? false,
    actions: input.actions,
  });

  const now = Date.now();
  const [row] = await db
    .insert(automations)
    .values({
      id: randomUUID(),
      name: input.name.trim(),
      description: input.description?.trim() || null,
      category: input.category,
      ...rowValuesFromTrigger(input.trigger),
      promptTemplate: firstTaskCreatePrompt(input.actions),
      actions: JSON.stringify(input.actions),
      taskConfig: input.taskConfig ? JSON.stringify(input.taskConfig) : null,
      projectId: input.projectId,
      enabled: input.isDraft ? 0 : input.enabled === false ? 0 : 1,
      isDraft: input.isDraft ? 1 : 0,
      lastRunAt: null,
      deadlinePolicy: input.deadlinePolicy ?? 'next-interval',
      deadlineMs: input.deadlineMs ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return mapAutomationRow(row);
}

export async function updateAutomation(
  id: string,
  patch: UpdateAutomationPatch
): Promise<Automation | null> {
  if (patch.projectId !== undefined && !(await projectExists(patch.projectId))) {
    throw new Error('project_not_found');
  }

  return db.transaction((tx) => {
    const [existingRow] = tx
      .select()
      .from(automations)
      .where(eq(automations.id, id))
      .limit(1)
      .all();
    if (!existingRow) return null;

    const existing = mapAutomationRow(existingRow);
    const finalIsDraft = patch.isDraft ?? existing.isDraft;
    const finalActions = patch.actions ?? existing.actions;
    const finalProjectId = patch.projectId ?? existing.projectId;
    const finalEnabled = patch.enabled ?? existing.enabled;
    assertValidAutomationInput({
      trigger: patch.trigger ?? existing.trigger,
      deadlinePolicy: patch.deadlinePolicy ?? existing.deadlinePolicy,
      deadlineMs: patch.deadlineMs !== undefined ? patch.deadlineMs : existing.deadlineMs,
      isDraft: finalIsDraft,
      actions: finalActions,
    });
    if (finalEnabled && finalIsDraft) throw new Error('automation_is_draft');
    if (finalEnabled && finalProjectId == null) throw new Error('no_project_attached');

    const values: Partial<typeof automations.$inferInsert> = { updatedAt: Date.now() };
    if (patch.name !== undefined) values.name = patch.name.trim();
    if (patch.description !== undefined) values.description = patch.description?.trim() || null;
    if (patch.category !== undefined) values.category = patch.category;
    if (patch.projectId !== undefined) {
      values.projectId = patch.projectId;
    }
    if (patch.enabled !== undefined) {
      values.enabled = patch.enabled ? 1 : 0;
      if (patch.enabled && !existing.enabled && patch.trigger === undefined) {
        values.nextRunAt = getNextRunAt(existing.trigger);
      }
    }
    if (patch.isDraft !== undefined) values.isDraft = patch.isDraft ? 1 : 0;
    if (patch.deadlinePolicy !== undefined) values.deadlinePolicy = patch.deadlinePolicy;
    if (patch.deadlineMs !== undefined) values.deadlineMs = patch.deadlineMs;
    if (patch.trigger !== undefined) Object.assign(values, rowValuesFromTrigger(patch.trigger));
    if (patch.actions !== undefined) {
      values.promptTemplate = firstTaskCreatePrompt(patch.actions);
      values.actions = JSON.stringify(patch.actions);
    }
    if (patch.taskConfig !== undefined) {
      values.taskConfig = patch.taskConfig ? JSON.stringify(patch.taskConfig) : null;
    }

    const [row] = tx
      .update(automations)
      .set(values)
      .where(eq(automations.id, id))
      .returning()
      .all();
    return row ? mapAutomationRow(row) : null;
  });
}

export async function detachProjectAutomations(projectId: string): Promise<Array<{ id: string }>> {
  const rows = await db
    .update(automations)
    .set({ projectId: null, nextRunAt: null, updatedAt: Date.now() })
    .where(eq(automations.projectId, projectId))
    .returning({ id: automations.id });
  return rows;
}

export async function removeAutomation(id: string): Promise<boolean> {
  const deleted = await db
    .delete(automations)
    .where(eq(automations.id, id))
    .returning({ id: automations.id });
  return deleted.length > 0;
}

export async function setAutomationEnabled(
  id: string,
  enabled: boolean
): Promise<Automation | null> {
  const existing = await getAutomation(id);
  if (!existing) return null;
  if (existing.isDraft && enabled) {
    throw new Error('automation_is_draft');
  }
  if (existing.projectId == null && enabled) {
    throw new Error('no_project_attached');
  }
  const nextRunAt = enabled ? getNextRunAt(existing.trigger) : existing.nextRunAt;
  const [row] = await db
    .update(automations)
    .set({ enabled: enabled ? 1 : 0, nextRunAt, updatedAt: Date.now() })
    .where(eq(automations.id, id))
    .returning();
  return row ? mapAutomationRow(row) : null;
}

export async function updateAutomationSchedule(
  id: string,
  values: { lastRunAt?: number | null; nextRunAt?: number | null }
): Promise<void> {
  await db
    .update(automations)
    .set({ ...values, updatedAt: Date.now() })
    .where(eq(automations.id, id));
}

async function activeCronAutomations(whereNextRunDue?: number): Promise<Automation[]> {
  const predicates = [
    eq(automations.enabled, 1),
    eq(automations.isDraft, 0),
    isNotNull(automations.projectId),
  ];
  if (whereNextRunDue !== undefined) {
    predicates.push(isNotNull(automations.nextRunAt), lte(automations.nextRunAt, whereNextRunDue));
  }

  const rows = await db
    .select()
    .from(automations)
    .where(and(...predicates));
  return mapAutomationRows(rows);
}

export async function dueCronAutomations(now = Date.now()): Promise<Automation[]> {
  return activeCronAutomations(now);
}

export async function enabledCronAutomations(): Promise<Automation[]> {
  return activeCronAutomations();
}

export async function hasRunningRuns(automationId: string): Promise<boolean> {
  const rows = await db
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(and(eq(automationRuns.automationId, automationId), eq(automationRuns.status, 'running')))
    .limit(1);
  return rows.length > 0;
}

export async function enqueueAutomationRun(input: {
  automationId: string;
  scheduledAt: number;
  deadlineAt: number | null;
  triggerKind: AutomationRunTriggerKind;
}): Promise<AutomationRun | null> {
  const runId = randomUUID();
  const rows = db.all<AutomationRunRow>(sql`
    INSERT INTO automation_runs (id, automation_id, scheduled_at, deadline_at, status, trigger_kind)
    SELECT ${runId}, ${input.automationId}, ${input.scheduledAt}, ${input.deadlineAt}, 'queued', ${input.triggerKind}
    WHERE NOT EXISTS (
      SELECT 1
      FROM automation_runs
      WHERE automation_id = ${input.automationId}
        AND status IN ('queued', 'running')
        ${input.triggerKind === 'cron' ? sql`AND scheduled_at = ${input.scheduledAt}` : sql``}
    )
    ${
      input.triggerKind === 'cron'
        ? sql`AND NOT EXISTS (
            SELECT 1
            FROM automation_runs
            WHERE automation_id = ${input.automationId}
              AND status = 'queued'
              AND trigger_kind = 'manual'
          )`
        : sql``
    }
    RETURNING
      id,
      automation_id AS automationId,
      scheduled_at AS scheduledAt,
      deadline_at AS deadlineAt,
      started_at AS startedAt,
      finished_at AS finishedAt,
      status,
      task_id AS taskId,
      created_task_id AS createdTaskId,
      error,
      trigger_kind AS triggerKind,
      worker_id AS workerId
  `);
  return rows[0] ? mapAutomationRunRow(rows[0]) : null;
}

export async function listQueuedRuns(limit = 100): Promise<
  Array<{
    run: AutomationRun;
    automation: Automation;
  }>
> {
  const rows = await db
    .select({ run: automationRuns, automation: automations })
    .from(automationRuns)
    .innerJoin(automations, eq(automationRuns.automationId, automations.id))
    .where(
      and(
        eq(automationRuns.status, 'queued'),
        or(
          eq(automationRuns.triggerKind, 'manual'),
          and(
            eq(automationRuns.triggerKind, 'cron'),
            eq(automations.enabled, 1),
            eq(automations.isDraft, 0)
          )
        )
      )
    )
    .orderBy(asc(automationRuns.scheduledAt), asc(automationRuns.startedAt))
    .limit(limit);
  return rows.flatMap(({ run, automation }) => {
    const mappedAutomation = mapAutomationRowSafely(automation);
    return mappedAutomation
      ? [{ run: mapAutomationRunRow(run), automation: mappedAutomation }]
      : [];
  });
}

export async function claimQueuedRun(
  id: string,
  workerId: string,
  now = Date.now()
): Promise<AutomationRun | null> {
  const rows = db.all<AutomationRunRow>(sql`
    UPDATE automation_runs
    SET status = 'running', started_at = ${now}, worker_id = ${workerId}
    WHERE id = ${id}
      AND status = 'queued'
      AND NOT EXISTS (
        SELECT 1
        FROM automation_runs AS running
        WHERE running.automation_id = automation_runs.automation_id
          AND running.status = 'running'
          AND running.id <> automation_runs.id
      )
    RETURNING
      id,
      automation_id AS automationId,
      scheduled_at AS scheduledAt,
      deadline_at AS deadlineAt,
      started_at AS startedAt,
      finished_at AS finishedAt,
      status,
      task_id AS taskId,
      created_task_id AS createdTaskId,
      error,
      trigger_kind AS triggerKind,
      worker_id AS workerId
  `);
  const [row] = rows;
  return row ? mapAutomationRunRow(row) : null;
}

export async function listRunningRunsForRecovery(): Promise<
  Array<Pick<AutomationRun, 'id' | 'taskId'>>
> {
  return db
    .select({ id: automationRuns.id, taskId: automationRuns.taskId })
    .from(automationRuns)
    .where(eq(automationRuns.status, 'running'));
}

export async function taskExists(taskId: string): Promise<boolean> {
  const rows = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return rows.length > 0;
}

export async function taskWasCreatedByAutomationRun(taskIdValue: string): Promise<boolean> {
  const rows = await db
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(
      or(eq(automationRuns.createdTaskId, taskIdValue), eq(automationRuns.taskId, taskIdValue))
    )
    .limit(1);
  return rows.length > 0;
}

export async function recoverQueuedRuns(): Promise<number> {
  const rows = await db
    .update(automationRuns)
    .set({ workerId: null })
    .where(eq(automationRuns.status, 'queued'))
    .returning({ id: automationRuns.id });
  return rows.length;
}

export async function insertRun(input: {
  automationId: string;
  scheduledAt?: number | null;
  deadlineAt?: number | null;
  status: AutomationRunStatus;
  triggerKind: AutomationRunTriggerKind;
  startedAt?: number | null;
  finishedAt?: number | null;
  taskId?: string | null;
  createdTaskId?: string | null;
  error?: string | null;
}): Promise<AutomationRun> {
  const [row] = await db
    .insert(automationRuns)
    .values({
      id: randomUUID(),
      automationId: input.automationId,
      scheduledAt: input.scheduledAt ?? null,
      deadlineAt: input.deadlineAt ?? null,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
      status: input.status,
      taskId: input.taskId ?? null,
      createdTaskId: input.createdTaskId ?? input.taskId ?? null,
      error: input.error ?? null,
      triggerKind: input.triggerKind,
      workerId: null,
    })
    .returning();
  return mapAutomationRunRow(row);
}

export async function updateRun(
  id: string,
  values: Partial<
    Pick<
      AutomationRun,
      | 'scheduledAt'
      | 'deadlineAt'
      | 'startedAt'
      | 'finishedAt'
      | 'status'
      | 'taskId'
      | 'createdTaskId'
      | 'error'
      | 'workerId'
    >
  >
): Promise<AutomationRun | null> {
  const [row] = await db
    .update(automationRuns)
    .set(values)
    .where(eq(automationRuns.id, id))
    .returning();
  return row ? mapAutomationRunRow(row) : null;
}

export async function getRun(id: string): Promise<AutomationRun | null> {
  const [row] = await db.select().from(automationRuns).where(eq(automationRuns.id, id)).limit(1);
  return row ? mapAutomationRunRow(row) : null;
}

export async function removeRun(id: string): Promise<boolean> {
  const deleted = await db
    .delete(automationRuns)
    .where(eq(automationRuns.id, id))
    .returning({ id: automationRuns.id });
  return deleted.length > 0;
}

export async function listRuns(automationId: string, limit = 20): Promise<AutomationRun[]> {
  const rows = await db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.automationId, automationId))
    .orderBy(desc(automationRuns.scheduledAt))
    .limit(limit);
  const runs = rows.map(mapAutomationRunRow);
  if (runs.length === 0) return [];

  const [automationRow] = await db
    .select({ id: automations.id, taskConfig: automations.taskConfig })
    .from(automations)
    .where(eq(automations.id, automationId))
    .limit(1);
  const fallbackProvider = automationRow ? automationTaskConfigAgentProvider(automationRow) : null;
  return attachAgentProviders(runs, () => fallbackProvider);
}

export async function listRecentRuns(
  projectId: string | undefined,
  limit = 50
): Promise<AutomationRunWithContext[]> {
  const base = db
    .select({ run: automationRuns, automation: automations })
    .from(automationRuns)
    .innerJoin(automations, eq(automationRuns.automationId, automations.id));
  const rows = await (projectId ? base.where(eq(automations.projectId, projectId)) : base)
    .orderBy(
      sql`coalesce(${automationRuns.startedAt}, ${automationRuns.scheduledAt}, ${automationRuns.finishedAt}) desc`
    )
    .limit(limit);
  const fallbackProviderByRunId = new Map(
    rows.map(({ run, automation }) => [run.id, automationTaskConfigAgentProvider(automation)])
  );
  const runs = rows.map(({ run, automation }) => ({
    ...mapAutomationRunRow(run),
    automationName: automation.name,
    projectId: automation.projectId,
  }));
  return attachAgentProviders(runs, (run) => fallbackProviderByRunId.get(run.id) ?? null);
}
