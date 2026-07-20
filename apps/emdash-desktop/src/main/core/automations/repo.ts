import { and, eq, isNull } from 'drizzle-orm';
import type { Automation } from '@core/primitives/automations/api';
import { automations, projects, type AutomationRow } from '@core/services/app-db/node/schema';
import { getAppDb } from '@main/db/instance';

function mapAutomationRow(row: AutomationRow): Automation {
  return {
    id: row.id,
    name: row.name,
    projectId: row.projectId ?? undefined,
    triggerConfig: row.triggerConfig ?? undefined,
    conversationConfig: row.conversationConfig ?? undefined,
    taskConfig: row.taskConfig ?? undefined,
    enabled: row.enabled === 1,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listAutomations(projectId?: string): Promise<Automation[]> {
  const rows = projectId
    ? await getAppDb()
        .select()
        .from(automations)
        .where(and(eq(automations.projectId, projectId), isNull(automations.deletedAt)))
    : await getAppDb().select().from(automations).where(isNull(automations.deletedAt));
  return rows.map(mapAutomationRow);
}

export async function getAutomation(id: string): Promise<Automation | null> {
  const [row] = await getAppDb()
    .select()
    .from(automations)
    .where(and(eq(automations.id, id), isNull(automations.deletedAt)))
    .limit(1);
  return row ? mapAutomationRow(row) : null;
}

export async function projectExists(projectId: string): Promise<boolean> {
  const [row] = await getAppDb()
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  return row !== undefined;
}

export async function insertAutomation(automation: Automation): Promise<Automation> {
  const [row] = await getAppDb()
    .insert(automations)
    .values({
      id: automation.id,
      name: automation.name,
      projectId: automation.projectId ?? null,
      triggerConfig: automation.triggerConfig ?? null,
      conversationConfig: automation.conversationConfig ?? null,
      taskConfig: automation.taskConfig ?? null,
      enabled: automation.enabled ? 1 : 0,
      revision: automation.revision,
      createdAt: automation.createdAt,
      updatedAt: automation.updatedAt,
    })
    .returning();
  return mapAutomationRow(row);
}

export async function replaceAutomation(automation: Automation): Promise<Automation | null> {
  const [row] = await getAppDb()
    .update(automations)
    .set({
      name: automation.name,
      projectId: automation.projectId ?? null,
      triggerConfig: automation.triggerConfig ?? null,
      conversationConfig: automation.conversationConfig ?? null,
      taskConfig: automation.taskConfig ?? null,
      enabled: automation.enabled ? 1 : 0,
      revision: automation.revision,
      updatedAt: automation.updatedAt,
    })
    .where(
      and(
        eq(automations.id, automation.id),
        eq(automations.revision, automation.revision - 1),
        isNull(automations.deletedAt)
      )
    )
    .returning();
  return row ? mapAutomationRow(row) : null;
}

export async function setAutomationRevision(id: string, revision: number): Promise<boolean> {
  const rows = await getAppDb()
    .update(automations)
    .set({ revision })
    .where(and(eq(automations.id, id), isNull(automations.deletedAt)))
    .returning({ id: automations.id });
  return rows.length > 0;
}

export async function deleteAutomationDefinition(id: string): Promise<boolean> {
  const rows = await getAppDb()
    .update(automations)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(automations.id, id), isNull(automations.deletedAt)))
    .returning({ id: automations.id });
  return rows.length > 0;
}
