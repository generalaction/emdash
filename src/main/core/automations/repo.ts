import { randomUUID } from 'node:crypto';
import { Cron } from 'croner';
import { and, asc, desc, eq, isNotNull, lte, or } from 'drizzle-orm';
import type { ActionSpec } from '@shared/automations/actions';
import { getLocalTimeZone } from '@shared/automations/timezone';
import type {
  Automation,
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTriggerKind,
  AutomationRunWithContext,
  CreateAutomationInput,
  TriggerSpec,
  UpdateAutomationPatch,
} from '@shared/automations/types';
import type { CreateTaskParams } from '@shared/tasks';
import { db } from '@main/db/client';
import {
  automationRuns,
  automations,
  projects,
  type AutomationRow,
  type AutomationRunRow,
} from '@main/db/schema';
import { log } from '@main/lib/logger';

const DEFAULT_TZ = getLocalTimeZone();

function fallbackActions(promptTemplate: string): ActionSpec[] {
  const prompt = promptTemplate.trim();
  return prompt ? [{ kind: 'task.create', prompt }] : [];
}

function parseActions(raw: string, promptTemplate: string): ActionSpec[] {
  if (!raw || raw === '[]') return fallbackActions(promptTemplate);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return fallbackActions(promptTemplate);
    return parsed.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        'kind' in item &&
        (item as { kind: unknown }).kind === 'task.create'
    )
      ? (parsed as ActionSpec[])
      : fallbackActions(promptTemplate);
  } catch (error) {
    log.warn('automations.repo: failed to parse actions JSON', {
      error: String(error),
    });
    return fallbackActions(promptTemplate);
  }
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

function firstTaskCreatePrompt(actions: ActionSpec[]): string {
  const first = actions.find((action) => action.kind === 'task.create');
  return first ? first.prompt : '';
}

const RUN_STATUSES: ReadonlySet<AutomationRunStatus> = new Set([
  'queued',
  'running',
  'success',
  'failed',
  'skipped',
]);
const RUN_TRIGGER_KINDS: ReadonlySet<AutomationRunTriggerKind> = new Set(['cron', 'manual']);

function asRunStatus(value: string): AutomationRunStatus {
  if (RUN_STATUSES.has(value as AutomationRunStatus)) return value as AutomationRunStatus;
  throw new Error(`automation_run_invalid_status:${value}`);
}

function asRunTriggerKind(value: string): AutomationRunTriggerKind {
  if (RUN_TRIGGER_KINDS.has(value as AutomationRunTriggerKind)) {
    return value as AutomationRunTriggerKind;
  }
  throw new Error(`automation_run_invalid_trigger_kind:${value}`);
}

function mapAutomationRow(row: AutomationRow): Automation {
  if (!row.cronExpr) throw new Error(`automation_row_missing_cron_expr:${row.id}`);
  const trigger: TriggerSpec = {
    kind: 'cron',
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAutomationRunRow(row: AutomationRunRow): AutomationRun {
  return {
    id: row.id,
    automationId: row.automationId,
    scheduledAt: row.scheduledAt,
    deadlineAt: row.deadlineAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: asRunStatus(row.status),
    taskId: row.taskId,
    createdTaskId: row.createdTaskId,
    error: row.error,
    triggerKind: asRunTriggerKind(row.triggerKind),
    workerId: row.workerId,
  };
}

export function getNextRunAt(
  trigger: TriggerSpec,
  from: number | Date = new Date()
): number | null {
  const next = new Cron(trigger.expr, { timezone: trigger.tz || DEFAULT_TZ }).nextRun(
    from instanceof Date ? from : new Date(from)
  );
  return next?.getTime() ?? null;
}

function rowValuesFromTrigger(trigger: TriggerSpec) {
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
  return rows.map(mapAutomationRow);
}

export async function getAutomation(id: string): Promise<Automation | null> {
  const [row] = await db.select().from(automations).where(eq(automations.id, id)).limit(1);
  return row ? mapAutomationRow(row) : null;
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
  const values: Partial<typeof automations.$inferInsert> = { updatedAt: Date.now() };
  if (patch.name !== undefined) values.name = patch.name.trim();
  if (patch.description !== undefined) values.description = patch.description?.trim() || null;
  if (patch.category !== undefined) values.category = patch.category;
  if (patch.projectId !== undefined) {
    if (!(await projectExists(patch.projectId))) {
      throw new Error('project_not_found');
    }
    values.projectId = patch.projectId;
  }
  if (patch.enabled !== undefined) values.enabled = patch.enabled ? 1 : 0;
  if (patch.isDraft !== undefined) values.isDraft = patch.isDraft ? 1 : 0;
  if (patch.builtinTemplateId !== undefined) values.builtinTemplateId = patch.builtinTemplateId;
  if (patch.trigger !== undefined) Object.assign(values, rowValuesFromTrigger(patch.trigger));
  if (patch.actions !== undefined) {
    values.actions = JSON.stringify(patch.actions);
    values.promptTemplate = firstTaskCreatePrompt(patch.actions);
  }
  if (patch.taskConfig !== undefined) {
    values.taskConfig = patch.taskConfig ? JSON.stringify(patch.taskConfig) : null;
  }

  const [row] = await db.update(automations).set(values).where(eq(automations.id, id)).returning();
  return row ? mapAutomationRow(row) : null;
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

export async function dueCronAutomations(now = Date.now()): Promise<Automation[]> {
  const rows = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.enabled, 1),
        eq(automations.isDraft, 0),
        isNotNull(automations.nextRunAt),
        lte(automations.nextRunAt, now)
      )
    );
  return rows.map(mapAutomationRow);
}

export async function enabledCronAutomations(): Promise<Automation[]> {
  const rows = await db
    .select()
    .from(automations)
    .where(and(eq(automations.enabled, 1), eq(automations.isDraft, 0)));
  return rows.map(mapAutomationRow);
}

export async function countRunningRuns(automationId: string): Promise<number> {
  const rows = await db
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(and(eq(automationRuns.automationId, automationId), eq(automationRuns.status, 'running')))
    .limit(1);
  return rows.length;
}

export async function enqueueAutomationRun(input: {
  automationId: string;
  scheduledAt: number;
  deadlineAt: number;
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
  return rows.map(({ run, automation }) => ({
    run: mapAutomationRunRow(run),
    automation: mapAutomationRow(automation),
  }));
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

export async function markRunningRunsInterrupted(now = Date.now()): Promise<number> {
  const rows = await db
    .update(automationRuns)
    .set({
      status: 'failed',
      finishedAt: now,
      error: 'interrupted_by_restart',
    })
    .where(eq(automationRuns.status, 'running'))
    .returning({ id: automationRuns.id });
  return rows.length;
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
    .orderBy(desc(automationRuns.startedAt))
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
    .orderBy(desc(automationRuns.startedAt))
    .limit(limit);
  return rows.map(({ run, automation }) => ({
    ...mapAutomationRunRow(run),
    automationName: automation.name,
    projectId: automation.projectId,
  }));
}
