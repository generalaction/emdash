import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { mapTaskRowToTask } from '@core/features/tasks/api/node/utils/utils';
import type { Task } from '@core/primitives/tasks/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { tasks } from '@core/services/app-db/node/schema';

export async function nameTaskFromConversation(
  db: AppDb,
  conversationId: string,
  title: string,
  preserveCapitalization = false,
  requested?: { projectId: string; taskId: string; expectedName: string }
): Promise<Task | undefined> {
  if (!conversationId) return undefined;
  // ponytail: keep the first five title words; providers may emit longer session titles.
  const words = title.match(/[a-z0-9]+/gi)?.slice(0, 5);
  const name = words?.join('-').slice(0, 64).replace(/-+$/, '');
  if (!name) return undefined;
  const normalizedName = preserveCapitalization ? name : name.toLowerCase();

  const updated = db.transaction((tx) => {
    const eligibility = requested
      ? and(
          eq(tasks.id, requested.taskId),
          eq(tasks.projectId, requested.projectId),
          eq(tasks.name, requested.expectedName)
        )
      : eq(tasks.autoNameConversationId, conversationId);
    const pending = tx
      .select()
      .from(tasks)
      .where(
        and(
          eligibility,
          isNull(tasks.deletedAt),
          isNull(tasks.archivedAt),
          requested ? undefined : isNull(tasks.linkedIssue),
          requested ? undefined : eq(tasks.type, 'task')
        )
      )
      .get();
    if (!pending) return undefined;

    const duplicate = tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, pending.projectId),
          ne(tasks.id, pending.id),
          isNull(tasks.deletedAt),
          sql`lower(${tasks.name}) = ${normalizedName.toLowerCase()}`
        )
      )
      .get();
    if (duplicate) {
      if (!requested) {
        tx.update(tasks)
          .set({ autoNameConversationId: null })
          .where(eq(tasks.id, pending.id))
          .run();
      }
      return undefined;
    }

    return tx
      .update(tasks)
      .set({
        name: normalizedName,
        autoNameConversationId: null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(tasks.id, pending.id), eligibility))
      .returning()
      .get();
  });
  if (!updated) return undefined;
  appDbPokes.tasks.poke({ projectId: updated.projectId, taskId: updated.id });
  return mapTaskRowToTask(updated);
}
