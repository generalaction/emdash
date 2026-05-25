import { randomUUID } from 'node:crypto';
import { Cron } from 'croner';
import { and, asc, desc, eq, isNotNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import {
  automationRuns,
  automations,
  projects,
  tasks,
  type AutomationRow,
  type AutomationRunRow,
} from '@main/db/schema';
import { log } from '@main/lib/logger';
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
    builtinTemplateId: row.builtinTemplateId,
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
    cronExpr: trigger.expr,
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
      builtinTemplateId: input.builtinTemplateId ?? null,
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

  return await db.transaction(async (tx) => {
    const [existingRow] = await tx
      .select()
      .from(automations)
      .where(eq(automations.id, id))
      .limit(1);
    if (!existingRow) return null;

    const existing = mapAutomationRow(existingRow);
    const finalIsDraft = patch.isDraft ?? existing.isDraft;
    const finalActions = patch.actions ?? existing.actions;
    if (!finalIsDraft) assertPublishableActions(finalActions);

    const values: Partial<typeof automations.$inferInsert> = { updatedAt: Date.now() };
    if (patch.name !== undefined) values.name = patch.name.trim();
    if (patch.description !== undefined) values.description = patch.description?.trim() || null;
    if (patch.category !== undefined) values.category = patch.category;
    if (patch.projectId !== undefined) {
      values.projectId = patch.projectId;
    }
    if (patch.enabled !== undefined) values.enabled = patch.enabled ? 1 : 0;
    if (patch.isDraft !== undefined) values.isDraft = patch.isDraft ? 1 : 0;
    if (patch.builtinTemplateId !== undefined) values.builtinTemplateId = patch.builtinTemplateId;
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

    const [row] = await tx
      .update(automations)
      .set(values)
      .where(eq(automations.id, id))
      .returning();
    return row ? mapAutomationRow(row) : null;
  });
}

export async function detachProject(projectId: string): Promise<number> {
  const rows = await detachProjectAutomations(projectId);
  return rows.length;
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
  const existing = await db
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.automationId, input.automationId),
        eq(automationRuns.scheduledAt, input.scheduledAt),
        or(eq(automationRuns.status, 'queued'), eq(automationRuns.status, 'running'))
      )
    )
    .limit(1);
  if (existing.length > 0) return null;

  return insertRun({
    automationId: input.automationId,
    scheduledAt: input.scheduledAt,
    deadlineAt: input.deadlineAt,
    status: 'queued',
    triggerKind: input.triggerKind,
  });
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
  const [row] = await db
    .update(automationRuns)
    .set({ status: 'running', startedAt: now, workerId })
    .where(and(eq(automationRuns.id, id), eq(automationRuns.status, 'queued')))
    .returning();
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
  return rows.map(mapAutomationRunRow);
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
  return rows.map(({ run, automation }) => ({
    ...mapAutomationRunRow(run),
    automationName: automation.name,
    projectId: automation.projectId,
  }));
}
