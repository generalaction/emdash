import { randomUUID } from 'node:crypto';
import { Cron } from 'croner';
import { and, desc, eq, isNotNull, lt, lte } from 'drizzle-orm';
import type { ActionSpec } from '@shared/automations/actions';
import type {
  AutomationEventKind,
  EventProviderScope,
  IntegrationProvider,
} from '@shared/automations/events';
import type {
  Automation,
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTriggerKind,
  CreateAutomationInput,
  TriggerSpec,
  UpdateAutomationPatch,
} from '@shared/automations/types';
import { db } from '@main/db/client';
import {
  automationEventCursors,
  automationRuns,
  automations,
  type AutomationEventCursorRow,
  type AutomationRow,
  type AutomationRunRow,
} from '@main/db/schema';
import { log } from '@main/lib/logger';

const DEFAULT_TZ = 'UTC';

function fallbackActions(promptTemplate: string): ActionSpec[] {
  const prompt = promptTemplate.trim();
  return prompt ? [{ kind: 'task.create', prompt }] : [];
}

function parseActions(raw: string, promptTemplate: string): ActionSpec[] {
  if (!raw || raw === '[]') return fallbackActions(promptTemplate);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return fallbackActions(promptTemplate);
    return parsed.every((item) => item && typeof item === 'object' && 'kind' in item)
      ? (parsed as ActionSpec[])
      : fallbackActions(promptTemplate);
  } catch (error) {
    log.warn('automations.repo: failed to parse actions JSON', {
      error: String(error),
    });
    return fallbackActions(promptTemplate);
  }
}

function firstTaskCreatePrompt(actions: ActionSpec[]): string {
  const first = actions.find((action) => action.kind === 'task.create');
  return first ? first.prompt : '';
}

const RUN_STATUSES: ReadonlySet<AutomationRunStatus> = new Set([
  'running',
  'success',
  'failed',
  'skipped',
]);
const RUN_TRIGGER_KINDS: ReadonlySet<AutomationRunTriggerKind> = new Set([
  'cron',
  'manual',
  'event',
]);

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
  let trigger: TriggerSpec;
  if (row.triggerType === 'cron') {
    if (!row.cronExpr) throw new Error(`automation_row_missing_cron_expr:${row.id}`);
    trigger = { kind: 'cron', expr: row.cronExpr, tz: row.cronTz ?? DEFAULT_TZ };
  } else if (row.triggerType === 'event') {
    if (!row.eventType) throw new Error(`automation_row_missing_event_type:${row.id}`);
    trigger = {
      kind: 'event',
      event: row.eventType as AutomationEventKind,
      provider: (row.eventProvider ?? null) as EventProviderScope | null,
    };
  } else {
    throw new Error(`automation_row_invalid_trigger_type:${row.triggerType}`);
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    trigger,
    actions: parseActions(row.actions, row.promptTemplate),
    projectId: row.projectId,
    enabled: row.enabled === 1,
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
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: asRunStatus(row.status),
    taskId: row.taskId,
    error: row.error,
    triggerKind: asRunTriggerKind(row.triggerKind),
  };
}

export function getNextRunAt(
  trigger: TriggerSpec,
  from: number | Date = new Date()
): number | null {
  if (trigger.kind !== 'cron') return null;
  const next = new Cron(trigger.expr, { timezone: trigger.tz || DEFAULT_TZ }).nextRun(
    from instanceof Date ? from : new Date(from)
  );
  return next?.getTime() ?? null;
}

function rowValuesFromTrigger(trigger: TriggerSpec) {
  if (trigger.kind === 'cron') {
    return {
      triggerType: 'cron',
      cronExpr: trigger.expr,
      cronTz: trigger.tz || DEFAULT_TZ,
      eventType: null,
      eventProvider: null,
      nextRunAt: getNextRunAt(trigger),
    };
  }
  return {
    triggerType: 'event',
    cronExpr: null,
    cronTz: null,
    eventType: trigger.event,
    eventProvider: trigger.provider ?? null,
    nextRunAt: null,
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

export async function createAutomation(input: CreateAutomationInput): Promise<Automation> {
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
      projectId: input.projectId,
      enabled: input.enabled === false ? 0 : 1,
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
  const existing = await getAutomation(id);
  if (!existing) return null;

  const values: Partial<typeof automations.$inferInsert> = { updatedAt: Date.now() };
  if (patch.name !== undefined) values.name = patch.name.trim();
  if (patch.description !== undefined) values.description = patch.description?.trim() || null;
  if (patch.category !== undefined) values.category = patch.category;
  if (patch.projectId !== undefined) values.projectId = patch.projectId;
  if (patch.enabled !== undefined) values.enabled = patch.enabled ? 1 : 0;
  if (patch.builtinTemplateId !== undefined) values.builtinTemplateId = patch.builtinTemplateId;
  if (patch.trigger !== undefined) Object.assign(values, rowValuesFromTrigger(patch.trigger));
  if (patch.actions !== undefined) {
    values.actions = JSON.stringify(patch.actions);
    values.promptTemplate = firstTaskCreatePrompt(patch.actions);
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
        eq(automations.triggerType, 'cron'),
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
    .where(and(eq(automations.enabled, 1), eq(automations.triggerType, 'cron')));
  return rows.map(mapAutomationRow);
}

export async function enabledEventAutomations(filter: {
  kind?: AutomationEventKind;
  provider?: EventProviderScope;
  projectId?: string;
}): Promise<Automation[]> {
  const conditions = [eq(automations.enabled, 1), eq(automations.triggerType, 'event')];
  if (filter.kind) conditions.push(eq(automations.eventType, filter.kind));
  if (filter.projectId) conditions.push(eq(automations.projectId, filter.projectId));

  const rows = await db
    .select()
    .from(automations)
    .where(and(...conditions));

  return rows.map(mapAutomationRow).filter((automation) => {
    if (automation.trigger.kind !== 'event') return false;
    if (filter.provider == null) return true;
    const scoped = automation.trigger.provider;
    return scoped == null || scoped === filter.provider;
  });
}

export async function hasEnabledEventAutomations(): Promise<boolean> {
  const rows = await db
    .select({ id: automations.id })
    .from(automations)
    .where(and(eq(automations.enabled, 1), eq(automations.triggerType, 'event')))
    .limit(1);
  return rows.length > 0;
}

export async function countRunningRuns(automationId: string): Promise<number> {
  const rows = await db
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(and(eq(automationRuns.automationId, automationId), eq(automationRuns.status, 'running')))
    .limit(1);
  return rows.length;
}

export async function insertRun(input: {
  automationId: string;
  status: AutomationRunStatus;
  triggerKind: AutomationRunTriggerKind;
  startedAt?: number;
  finishedAt?: number | null;
  taskId?: string | null;
  error?: string | null;
}): Promise<AutomationRun> {
  const [row] = await db
    .insert(automationRuns)
    .values({
      id: randomUUID(),
      automationId: input.automationId,
      startedAt: input.startedAt ?? Date.now(),
      finishedAt: input.finishedAt ?? null,
      status: input.status,
      taskId: input.taskId ?? null,
      error: input.error ?? null,
      triggerKind: input.triggerKind,
    })
    .returning();
  return mapAutomationRunRow(row);
}

export async function updateRun(
  id: string,
  values: Partial<Pick<AutomationRun, 'finishedAt' | 'status' | 'taskId' | 'error'>>
): Promise<AutomationRun | null> {
  const [row] = await db
    .update(automationRuns)
    .set(values)
    .where(eq(automationRuns.id, id))
    .returning();
  return row ? mapAutomationRunRow(row) : null;
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

export async function overdueCronAutomations(cutoff: number): Promise<Automation[]> {
  const rows = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.enabled, 1),
        eq(automations.triggerType, 'cron'),
        isNotNull(automations.nextRunAt),
        lt(automations.nextRunAt, cutoff)
      )
    );
  return rows.map(mapAutomationRow);
}

export type AutomationEventCursorRecord = {
  provider: IntegrationProvider;
  projectId: string;
  lastPolledAt: number;
  cursor: string | null;
};

function mapCursorRow(row: AutomationEventCursorRow): AutomationEventCursorRecord {
  return {
    provider: row.provider as IntegrationProvider,
    projectId: row.projectId,
    lastPolledAt: row.lastPolledAt,
    cursor: row.cursor,
  };
}

export async function getEventCursor(
  provider: IntegrationProvider,
  projectId: string
): Promise<AutomationEventCursorRecord | null> {
  const [row] = await db
    .select()
    .from(automationEventCursors)
    .where(
      and(
        eq(automationEventCursors.provider, provider),
        eq(automationEventCursors.projectId, projectId)
      )
    )
    .limit(1);
  return row ? mapCursorRow(row) : null;
}

export async function upsertEventCursor(input: {
  provider: IntegrationProvider;
  projectId: string;
  cursor: string | null;
  lastPolledAt?: number;
}): Promise<void> {
  const lastPolledAt = input.lastPolledAt ?? Date.now();
  await db
    .insert(automationEventCursors)
    .values({
      provider: input.provider,
      projectId: input.projectId,
      lastPolledAt,
      cursor: input.cursor,
    })
    .onConflictDoUpdate({
      target: [automationEventCursors.provider, automationEventCursors.projectId],
      set: { lastPolledAt, cursor: input.cursor },
    });
}
