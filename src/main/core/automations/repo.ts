import { randomUUID } from 'node:crypto';
import { Cron } from 'croner';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { generateRandom } from '@main/core/tasks/name-generation/generateTaskName';
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
import type {
  Automation,
  CreateAutomationParams,
  UpdateAutomationSettingsPatch,
} from '@shared/automations/automation';
import type {
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTriggerKind,
} from '@shared/automations/automation-run';
import type {
  ConversationConfig,
  StoredAutomationTaskConfig,
  TriggerConfig,
} from '@shared/automations/config';
import { getLocalTimeZone } from '@shared/automations/timezone';
import { assertValidCronTrigger } from '@shared/automations/validation';

const DEFAULT_TZ = getLocalTimeZone();

function parseTriggerConfig(raw: string | null): TriggerConfig | null {
  if (!raw || raw === '{}' || raw === 'null') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj['expr'] !== 'string' || !obj['expr']) return null;
    return parsed as TriggerConfig;
  } catch (error) {
    log.warn('automations.repo: failed to parse triggerConfig JSON', { error: String(error) });
    return null;
  }
}

function parseConversationConfig(raw: string | null): ConversationConfig | null {
  if (!raw || raw === '{}' || raw === 'null') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj['prompt'] !== 'string' || !(obj['prompt'] as string).trim()) return null;
    if (typeof obj['provider'] !== 'string' || !obj['provider']) return null;
    return parsed as ConversationConfig;
  } catch (error) {
    log.warn('automations.repo: failed to parse conversationConfig JSON', { error: String(error) });
    return null;
  }
}

function parseTaskConfig(raw: string | null): StoredAutomationTaskConfig | null {
  if (!raw || raw === 'null') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (!('taskConfig' in obj) || !('workspaceConfig' in obj)) return null;
    return parsed as StoredAutomationTaskConfig;
  } catch (error) {
    log.warn('automations.repo: failed to parse taskConfig JSON', { error: String(error) });
    return null;
  }
}

function assertValidAutomationInput(input: {
  triggerConfig: TriggerConfig;
  conversationConfig: ConversationConfig;
}): void {
  assertValidCronTrigger(input.triggerConfig);
  if (!input.conversationConfig.prompt.trim()) {
    throw new Error('conversation_config_prompt_required');
  }
}

const RUN_STATUSES: ReadonlySet<AutomationRunStatus> = new Set([
  'scheduled',
  'queued',
  'creating_task',
  'launching_task',
  'creating_conversation',
  'done',
  'failed',
  'skipped',
]);
const RUN_TRIGGER_KINDS: ReadonlySet<AutomationRunTriggerKind> = new Set(['cron', 'manual']);

function asRunStatus(value: string, runId: string): AutomationRunStatus {
  if (RUN_STATUSES.has(value as AutomationRunStatus)) return value as AutomationRunStatus;
  log.warn('automations.repo: invalid run status, falling back to failed', { runId, value });
  return 'failed';
}

function asRunTriggerKind(value: string, runId: string): AutomationRunTriggerKind {
  if (RUN_TRIGGER_KINDS.has(value as AutomationRunTriggerKind)) {
    return value as AutomationRunTriggerKind;
  }
  log.warn('automations.repo: invalid run trigger_kind, falling back to manual', { runId, value });
  return 'manual';
}

function mapAutomationRow(row: AutomationRow): Automation {
  return {
    id: row.id,
    name: row.name,
    projectId: row.projectId ?? undefined,
    triggerConfig: parseTriggerConfig(row.triggerConfig) ?? undefined,
    conversationConfig: parseConversationConfig(row.conversationConfig) ?? undefined,
    taskConfig: parseTaskConfig(row.taskConfig) ?? undefined,
    enabled: row.enabled === 1,
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

function parseSnapshotTriggerConfig(raw: string, runId: string): TriggerConfig {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>)['expr'] === 'string'
    ) {
      return parsed as TriggerConfig;
    }
  } catch {
    // fall through
  }
  log.warn('automations.repo: invalid triggerConfigSnapshot, using empty', { runId });
  return { expr: '' };
}

function parseSnapshotConversationConfig(raw: string, runId: string): ConversationConfig {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>)['prompt'] === 'string'
    ) {
      return parsed as ConversationConfig;
    }
  } catch {
    // fall through
  }
  log.warn('automations.repo: invalid conversationConfigSnapshot, using empty', { runId });
  return { prompt: '', provider: '', autoApprove: false };
}

function mapAutomationRunRow(row: AutomationRunRow, taskId: string | null = null): AutomationRun {
  return {
    id: row.id,
    automationId: row.automationId,
    scheduledAt: row.scheduledAt,
    deadlineAt: row.deadlineAt,
    startedAt: row.startedAt,
    taskCreatedAt: row.taskCreatedAt,
    launchedAt: row.launchedAt,
    finishedAt: row.finishedAt,
    status: asRunStatus(row.status, row.id),
    taskId,
    generatedTaskName: row.generatedTaskName ?? null,
    error: row.error,
    triggerKind: asRunTriggerKind(row.triggerKind, row.id),
    triggerConfigSnapshot: parseSnapshotTriggerConfig(row.triggerConfigSnapshot, row.id),
    conversationConfigSnapshot: parseSnapshotConversationConfig(
      row.conversationConfigSnapshot,
      row.id
    ),
    taskConfigSnapshot: parseTaskConfig(row.taskConfigSnapshot),
  };
}

export function automationRunDeadline(
  automation: Automation,
  scheduledAt: number,
  triggerKind: AutomationRunTriggerKind
): number | null {
  if (triggerKind === 'cron' && automation.triggerConfig) {
    return getNextRunAt(automation.triggerConfig, scheduledAt);
  }
  return null;
}

export function getNextRunAt(
  trigger: TriggerConfig,
  from: number | Date = new Date()
): number | null {
  const next = new Cron(trigger.expr, { timezone: trigger.tz || DEFAULT_TZ }).nextRun(
    from instanceof Date ? from : new Date(from)
  );
  return next?.getTime() ?? null;
}

export async function listAutomations(projectId?: string): Promise<Automation[]> {
  const query = projectId
    ? db
        .select()
        .from(automations)
        .where(and(eq(automations.projectId, projectId), isNull(automations.deletedAt)))
    : db.select().from(automations).where(isNull(automations.deletedAt));
  const rows = await query;
  return mapAutomationRows(rows);
}

export async function getAutomation(id: string): Promise<Automation | null> {
  const [row] = await db
    .select()
    .from(automations)
    .where(and(eq(automations.id, id), isNull(automations.deletedAt)))
    .limit(1);
  return row ? mapAutomationRowSafely(row) : null;
}

export async function skipQueuedCronRuns(
  automationId: string,
  code: string
): Promise<AutomationRun[]> {
  const error = JSON.stringify({ step: 'queue', code });
  const rows = await db
    .update(automationRuns)
    .set({ status: 'skipped', finishedAt: Date.now(), error })
    .where(
      and(
        eq(automationRuns.automationId, automationId),
        inArray(automationRuns.status, ['scheduled', 'queued']),
        eq(automationRuns.triggerKind, 'cron')
      )
    )
    .returning();
  return rows.map((row) => mapAutomationRunRow(row));
}

async function projectExists(projectId: string): Promise<boolean> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return rows.length > 0;
}

export async function createAutomation(input: CreateAutomationParams): Promise<Automation> {
  if (!(await projectExists(input.projectId))) {
    throw new Error('project_not_found');
  }

  assertValidAutomationInput({
    triggerConfig: input.triggerConfig,
    conversationConfig: input.conversationConfig,
  });

  const now = Date.now();
  const [row] = await db
    .insert(automations)
    .values({
      id: randomUUID(),
      name: input.name.trim(),
      triggerConfig: JSON.stringify(input.triggerConfig),
      conversationConfig: JSON.stringify(input.conversationConfig),
      taskConfig: input.taskConfig ? JSON.stringify(input.taskConfig) : null,
      projectId: input.projectId,
      enabled: input.enabled === false ? 0 : 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const automation = mapAutomationRow(row);
  if (automation.enabled) {
    await ensureNextCronRun(automation);
  }
  return automation;
}

export async function updateAutomationSettings(
  id: string,
  patch: UpdateAutomationSettingsPatch
): Promise<Automation | null> {
  if (patch.projectId !== undefined && !(await projectExists(patch.projectId))) {
    throw new Error('project_not_found');
  }

  return db.transaction((tx) => {
    const [existingRow] = tx
      .select()
      .from(automations)
      .where(and(eq(automations.id, id), isNull(automations.deletedAt)))
      .limit(1)
      .all();
    if (!existingRow) return null;

    const existing = mapAutomationRow(existingRow);
    const finalTriggerConfig = patch.triggerConfig ?? existing.triggerConfig;
    const finalConversationConfig = patch.conversationConfig ?? existing.conversationConfig;
    const finalProjectId = patch.projectId !== undefined ? patch.projectId : existing.projectId;

    if (finalTriggerConfig && finalConversationConfig) {
      assertValidAutomationInput({
        triggerConfig: finalTriggerConfig,
        conversationConfig: finalConversationConfig,
      });
    }
    if (existing.enabled && finalProjectId == null) throw new Error('no_project_attached');

    const values: Partial<typeof automations.$inferInsert> = { updatedAt: Date.now() };
    if (patch.projectId !== undefined) values.projectId = patch.projectId;
    if (patch.triggerConfig !== undefined) {
      values.triggerConfig = JSON.stringify(patch.triggerConfig);
    }
    if (patch.conversationConfig !== undefined) {
      values.conversationConfig = JSON.stringify(patch.conversationConfig);
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

export async function renameAutomation(id: string, name: string): Promise<Automation | null> {
  const [row] = await db
    .update(automations)
    .set({ name: name.trim(), updatedAt: Date.now() })
    .where(and(eq(automations.id, id), isNull(automations.deletedAt)))
    .returning();
  return row ? mapAutomationRow(row) : null;
}

export async function detachProjectAutomations(projectId: string): Promise<Array<{ id: string }>> {
  const rows = await db
    .update(automations)
    .set({ projectId: null, updatedAt: Date.now() })
    .where(and(eq(automations.projectId, projectId), isNull(automations.deletedAt)))
    .returning({ id: automations.id });
  return rows;
}

export async function softDeleteAutomation(id: string): Promise<boolean> {
  const rows = await db
    .update(automations)
    .set({ deletedAt: Date.now() })
    .where(and(eq(automations.id, id), isNull(automations.deletedAt)))
    .returning({ id: automations.id });
  return rows.length > 0;
}

export async function setAutomationEnabled(
  id: string,
  enabled: boolean
): Promise<Automation | null> {
  const existing = await getAutomation(id);
  if (!existing) return null;
  if (existing.projectId == null && enabled) {
    throw new Error('no_project_attached');
  }
  const [row] = await db
    .update(automations)
    .set({ enabled: enabled ? 1 : 0, updatedAt: Date.now() })
    .where(eq(automations.id, id))
    .returning();
  return row ? mapAutomationRow(row) : null;
}

export async function ensureNextCronRun(
  automation: Automation,
  from: number | Date = new Date()
): Promise<AutomationRun | null> {
  if (!automation.triggerConfig || !automation.conversationConfig) return null;
  const scheduledAt = getNextRunAt(automation.triggerConfig, from);
  if (scheduledAt == null) return null;
  return scheduleAutomationRun({
    automationId: automation.id,
    triggerConfigSnapshot: automation.triggerConfig,
    conversationConfigSnapshot: automation.conversationConfig,
    taskConfigSnapshot: automation.taskConfig ?? null,
    scheduledAt,
    deadlineAt: getNextRunAt(automation.triggerConfig, scheduledAt),
    triggerKind: 'cron',
  });
}

export async function markDueCronRunsQueued(
  now = Date.now()
): Promise<Array<{ run: AutomationRun; automation: Automation }>> {
  const rows = await db
    .select({ run: automationRuns, automation: automations })
    .from(automationRuns)
    .innerJoin(automations, eq(automationRuns.automationId, automations.id))
    .where(
      and(
        eq(automationRuns.status, 'scheduled'),
        eq(automationRuns.triggerKind, 'cron'),
        sql`${automationRuns.scheduledAt} <= ${now}`,
        eq(automations.enabled, 1),
        sql`${automations.projectId} IS NOT NULL`,
        isNull(automations.deletedAt)
      )
    )
    .orderBy(asc(automationRuns.scheduledAt));

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.run.id);
  await db.update(automationRuns).set({ status: 'queued' }).where(inArray(automationRuns.id, ids));

  return rows.flatMap(({ run, automation }) => {
    const mappedAutomation = mapAutomationRowSafely(automation);
    return mappedAutomation
      ? [
          {
            run: { ...mapAutomationRunRow(run), status: 'queued' as const },
            automation: mappedAutomation,
          },
        ]
      : [];
  });
}

export async function enabledAutomationsWithoutQueuedRun(): Promise<Automation[]> {
  const rows = await db
    .select({ automation: automations })
    .from(automations)
    .leftJoin(
      automationRuns,
      and(
        eq(automationRuns.automationId, automations.id),
        inArray(automationRuns.status, ['scheduled', 'queued']),
        eq(automationRuns.triggerKind, 'cron')
      )
    )
    .where(
      and(
        eq(automations.enabled, 1),
        sql`${automations.projectId} IS NOT NULL`,
        isNull(automations.deletedAt),
        isNull(automationRuns.id)
      )
    );
  return rows.flatMap(({ automation }) => {
    const mapped = mapAutomationRowSafely(automation);
    return mapped ? [mapped] : [];
  });
}

export async function scheduleAutomationRun(input: {
  automationId: string;
  triggerConfigSnapshot: TriggerConfig;
  conversationConfigSnapshot: ConversationConfig;
  taskConfigSnapshot: StoredAutomationTaskConfig | null;
  scheduledAt: number;
  deadlineAt: number | null;
  triggerKind: AutomationRunTriggerKind;
}): Promise<AutomationRun | null> {
  const runId = randomUUID();
  const generatedTaskName = generateRandom();
  const triggerSnap = JSON.stringify(input.triggerConfigSnapshot);
  const convSnap = JSON.stringify(input.conversationConfigSnapshot);
  const taskSnap = input.taskConfigSnapshot ? JSON.stringify(input.taskConfigSnapshot) : null;
  const rows = db.all<AutomationRunRow>(sql`
    INSERT INTO automation_runs (
      id, automation_id, scheduled_at, deadline_at, status, trigger_kind,
      trigger_config_snapshot, conversation_config_snapshot, task_config_snapshot,
      generated_task_name
    )
    SELECT
      ${runId}, ${input.automationId}, ${input.scheduledAt}, ${input.deadlineAt},
      'scheduled', ${input.triggerKind},
      ${triggerSnap}, ${convSnap}, ${taskSnap},
      ${generatedTaskName}
    WHERE NOT EXISTS (
      SELECT 1
      FROM automation_runs
      WHERE automation_id = ${input.automationId}
        AND scheduled_at = ${input.scheduledAt}
        AND trigger_kind = 'cron'
        AND status IN ('scheduled', 'queued')
    )
    RETURNING
      id,
      automation_id AS automationId,
      scheduled_at AS scheduledAt,
      deadline_at AS deadlineAt,
      started_at AS startedAt,
      task_created_at AS taskCreatedAt,
      launched_at AS launchedAt,
      finished_at AS finishedAt,
      status,
      generated_task_name AS generatedTaskName,
      error,
      trigger_kind AS triggerKind,
      trigger_config_snapshot AS triggerConfigSnapshot,
      conversation_config_snapshot AS conversationConfigSnapshot,
      task_config_snapshot AS taskConfigSnapshot
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
        eq(automations.enabled, 1),
        isNull(automations.deletedAt)
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

export async function startCreatingTask(
  id: string,
  now = Date.now()
): Promise<AutomationRun | null> {
  const rows = db.all<AutomationRunRow>(sql`
    UPDATE automation_runs
    SET status = 'creating_task', started_at = ${now}
    WHERE id = ${id}
      AND status = 'queued'
    RETURNING
      id,
      automation_id AS automationId,
      scheduled_at AS scheduledAt,
      deadline_at AS deadlineAt,
      started_at AS startedAt,
      task_created_at AS taskCreatedAt,
      launched_at AS launchedAt,
      finished_at AS finishedAt,
      status,
      error,
      trigger_kind AS triggerKind,
      trigger_config_snapshot AS triggerConfigSnapshot,
      conversation_config_snapshot AS conversationConfigSnapshot,
      task_config_snapshot AS taskConfigSnapshot
  `);
  const [row] = rows;
  return row ? mapAutomationRunRow(row) : null;
}

export async function isAutomationRunTask(taskId: string): Promise<boolean> {
  const [row] = await db
    .select({ type: tasks.type })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row?.type === 'automation-run';
}

export async function insertRun(input: {
  automationId: string;
  triggerConfigSnapshot: TriggerConfig;
  conversationConfigSnapshot: ConversationConfig;
  taskConfigSnapshot?: StoredAutomationTaskConfig | null;
  scheduledAt?: number | null;
  deadlineAt?: number | null;
  status: AutomationRunStatus;
  triggerKind: AutomationRunTriggerKind;
  startedAt?: number | null;
  taskCreatedAt?: number | null;
  launchedAt?: number | null;
  finishedAt?: number | null;
  generatedTaskName?: string | null;
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
      taskCreatedAt: input.taskCreatedAt ?? null,
      launchedAt: input.launchedAt ?? null,
      finishedAt: input.finishedAt ?? null,
      status: input.status,
      generatedTaskName: input.generatedTaskName ?? generateRandom(),
      error: input.error ?? null,
      triggerKind: input.triggerKind,
      triggerConfigSnapshot: JSON.stringify(input.triggerConfigSnapshot),
      conversationConfigSnapshot: JSON.stringify(input.conversationConfigSnapshot),
      taskConfigSnapshot: input.taskConfigSnapshot
        ? JSON.stringify(input.taskConfigSnapshot)
        : null,
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
      | 'taskCreatedAt'
      | 'launchedAt'
      | 'finishedAt'
      | 'status'
      | 'error'
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

export async function findRunsStuckInCreatingTask(): Promise<Array<{ id: string }>> {
  const rows = await db
    .select({ id: automationRuns.id, taskId: tasks.id })
    .from(automationRuns)
    .leftJoin(tasks, eq(tasks.automationRunId, automationRuns.id))
    .where(and(eq(automationRuns.status, 'creating_task'), isNull(tasks.id)));
  return rows.map((r) => ({ id: r.id }));
}

export async function findRunsStuckInLaunchingTask(): Promise<
  Array<{ id: string; taskId: string }>
> {
  const rows = await db
    .select({ id: automationRuns.id, taskId: tasks.id })
    .from(automationRuns)
    .leftJoin(tasks, eq(tasks.automationRunId, automationRuns.id))
    .where(eq(automationRuns.status, 'launching_task'));
  return rows.filter((r): r is { id: string; taskId: string } => r.taskId !== null);
}

export async function findRunsStuckInCreatingConversation(): Promise<
  Array<{ id: string; taskId: string }>
> {
  const rows = await db
    .select({ id: automationRuns.id, taskId: tasks.id })
    .from(automationRuns)
    .leftJoin(tasks, eq(tasks.automationRunId, automationRuns.id))
    .where(eq(automationRuns.status, 'creating_conversation'));
  return rows.filter((r): r is { id: string; taskId: string } => r.taskId !== null);
}

export async function getRun(id: string): Promise<AutomationRun | null> {
  const [row] = await db
    .select({ run: automationRuns, taskId: tasks.id })
    .from(automationRuns)
    .leftJoin(tasks, eq(tasks.automationRunId, automationRuns.id))
    .where(eq(automationRuns.id, id))
    .limit(1);
  return row ? mapAutomationRunRow(row.run, row.taskId) : null;
}

export async function removeRun(id: string): Promise<boolean> {
  const deleted = await db
    .delete(automationRuns)
    .where(eq(automationRuns.id, id))
    .returning({ id: automationRuns.id });
  return deleted.length > 0;
}
