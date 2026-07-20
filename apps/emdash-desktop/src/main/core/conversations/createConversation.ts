import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { conversationWireEvents } from '@core/features/conversations/node';
import { type ConversationConfig } from '@core/primitives/conversations/api';
import {
  type Conversation,
  type CreateConversationParams,
} from '@core/primitives/conversations/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { conversations } from '@core/services/app-db/node/schema';
import { withCompensation } from '@main/core/utils/compensation';
import { getAppDb } from '@main/db/instance';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { conversationEvents } from './conversation-events';
import { launchTuiConversation } from './launch-tui-conversation';
import { mapConversationRowToConversation } from './utils';

type ConversationCreateDb = Pick<AppDb, 'delete' | 'insert' | 'select' | 'update'>;

export async function createConversation(
  params: CreateConversationParams,
  database: ConversationCreateDb = getAppDb()
): Promise<Conversation> {
  const id = params.id ?? randomUUID();
  const [existingConversation] = await database
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.taskId, params.taskId))
    .limit(1);

  const conversationType = params.type ?? 'pty';

  const initialQueue = params.initialQueue?.filter((prompt) => prompt.text.trim());
  const configObj: ConversationConfig =
    conversationType === 'acp'
      ? {
          version: '1',
          type: 'acp',
          ...(params.autoApprove !== undefined && { autoApprove: params.autoApprove }),
          ...(params.model && { model: params.model }),
          ...(initialQueue?.length && { initialQueue }),
        }
      : {
          version: '1',
          type: 'pty',
          ...(params.autoApprove !== undefined && { autoApprove: params.autoApprove }),
          ...(params.model && { model: params.model }),
          ...(params.initialPrompt && { initialPrompt: params.initialPrompt }),
        };
  const config = configObj;

  const [row] = await database
    .insert(conversations)
    .values({
      id,
      projectId: params.projectId,
      taskId: params.taskId,
      title: params.title,
      provider: params.provider,
      config,
      // Null means this conversation has not successfully spawned yet. PTY placeholder
      // ids and ACP/native provider ids are written only after their session exists.
      sessionId: null,
      isInitialConversation: params.isInitialConversation ?? false,
      type: conversationType,
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      lastInteractedAt: new Date().toISOString(),
    })
    .returning();

  let conversation = mapConversationRowToConversation(row);

  // ACP conversations start lazily on hydrateConversation — no PTY session here.
  if (conversationType !== 'acp') {
    const launched = await withCompensation({
      action: () =>
        launchTuiConversation({
          projectId: params.projectId,
          taskId: params.taskId,
          conversationId: id,
          initialSize: params.initialSize,
          database,
        }),
      compensate: async () => {
        await database.delete(conversations).where(eq(conversations.id, row.id)).execute();
      },
      onCompensationError: (error) => {
        log.error('createConversation: failed to roll back conversation row after spawn failure', {
          conversationId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
    conversation = launched.conversation;
  }

  conversationEvents._emit('conversation:created', conversation);
  conversationWireEvents.emit(undefined, { type: 'created', conversation });
  telemetryService.capture('conversation_created', {
    provider: params.provider,
    is_first_in_task: existingConversation === undefined,
    project_id: params.projectId,
    task_id: params.taskId,
    conversation_id: id,
  });

  return conversation;
}
