import { and, eq, inArray } from 'drizzle-orm';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { viewStateService } from '@main/core/view-state/view-state-service';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import type { Conversation } from '@shared/conversations';
import type { TaskViewSnapshot } from '@shared/view-state';
import { getConversationIdsForInitialHydration } from './hydration';

export async function loadConversationsForInitialHydration(
  projectId: string,
  taskId: string
): Promise<Conversation[]> {
  const snapshot = (await viewStateService.get(`task:${taskId}`)) as
    | Partial<TaskViewSnapshot>
    | null
    | undefined;
  const ids = [...getConversationIdsForInitialHydration(snapshot)];
  if (ids.length === 0) return [];

  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId),
        inArray(conversations.id, ids)
      )
    );

  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [mapConversationRowToConversation(row, true)] : [];
  });
}
