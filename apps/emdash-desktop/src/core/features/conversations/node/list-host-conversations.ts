import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { conversationRegistryTable as conversations } from '@core/features/conversations/api/node/registry';
import type {
  HostConversationRow,
  HostConversationScope,
} from '@core/primitives/conversations/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { projects, tasks } from '@core/services/app-db/node/schema';

export type ActiveOperationInputsReader = (operationName: string) => Promise<readonly unknown[]>;

const deleteInputWithConversationId = z.object({ conversationId: z.string() });

/**
 * The machine page's discovery and cleanup read (spec §8): every cached conversation
 * observation of one host — task-linked and orphaned alike — plus tombstoned rows whose
 * `host-delete-conversation` outbox entry is still in flight (removal-pending rows).
 */
export async function listHostConversations(
  db: AppDb,
  activeOperationInputs: ActiveOperationInputsReader,
  scope: HostConversationScope
): Promise<HostConversationRow[]> {
  const hostIdentity =
    scope.sshConnectionId === null
      ? isNull(conversations.sshConnectionId)
      : eq(conversations.sshConnectionId, scope.sshConnectionId);

  const pendingDeletionIds = new Set(
    (await activeOperationInputs('host-delete-conversation'))
      .map((input) => deleteInputWithConversationId.safeParse(input))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data.conversationId)
  );

  const rows = db
    .select({
      conversation: conversations,
      projectName: projects.name,
      taskName: tasks.name,
    })
    .from(conversations)
    .leftJoin(projects, eq(conversations.projectId, projects.id))
    .leftJoin(tasks, eq(conversations.taskId, tasks.id))
    .where(and(eq(conversations.location, scope.location), hostIdentity))
    .all();

  const result: HostConversationRow[] = [];
  for (const { conversation, projectName, taskName } of rows) {
    const live = conversation.untrackedAt === null;
    const pendingRemoval = !live && pendingDeletionIds.has(conversation.id);
    // Untracked rows without a live delete operation are settled removals (or forget-host
    // leftovers awaiting purge) — not part of the host's conversations surface.
    if (!live && !pendingRemoval) continue;
    result.push({
      id: conversation.id,
      title: conversation.title,
      provider: conversation.provider,
      type: conversation.type,
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      projectName: projectName ?? null,
      taskName: taskName ?? null,
      workspacePath: conversation.workspacePath,
      lastSessionActivityAt: conversation.lastSessionActivityAt,
      observedStatus: conversation.observedStatus,
      lastObservedAt: conversation.lastObservedAt,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      pendingRemoval,
    });
  }
  return result;
}
