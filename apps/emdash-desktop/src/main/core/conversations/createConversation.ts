import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { withCompensation } from '@main/core/utils/compensation';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { type AgentEvent } from '@shared/core/agents/agentEvents';
import { type ConversationConfig } from '@shared/core/conversations/conversation-config';
import { conversationCreatedChannel } from '@shared/core/conversations/conversationEvents';
import {
  type Conversation,
  type CreateConversationParams,
} from '@shared/core/conversations/conversations';
import {
  agentHookService,
  providerSupportsNativeStartHook,
} from '../agent-hooks/agent-hook-service';
import { isAppFocused } from '../agent-hooks/notification';
import { resolveTask } from '../projects/utils';
import { conversationEvents } from './conversation-events';
import { mapConversationRowToConversation } from './utils';

type ConversationCreateDb = Pick<typeof db, 'delete' | 'insert' | 'select'>;

function emitInitialPromptStarted(
  conversation: Conversation,
  params: CreateConversationParams
): void {
  if (!params.initialPrompt?.trim() || providerSupportsNativeStartHook(params.provider)) return;

  const agentEvent: AgentEvent = {
    type: 'start',
    source: 'input',
    providerId: params.provider,
    projectId: params.projectId,
    taskId: params.taskId,
    conversationId: conversation.id,
    timestamp: Date.now(),
    payload: {},
  };
  agentHookService.emitAgentEvent(agentEvent, isAppFocused());
}

export async function createConversation(
  params: CreateConversationParams,
  database: ConversationCreateDb = db
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
      // ACP conversations do not have an active PTY session; sessionId is left null
      // and will be populated later when the ACP session establishes a provider session id.
      sessionId: conversationType === 'acp' ? null : id,
      isInitialConversation: params.isInitialConversation ?? false,
      type: conversationType,
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      lastInteractedAt: new Date().toISOString(),
    })
    .returning();

  const conversation = mapConversationRowToConversation(row);

  // ACP conversations start lazily on hydrateConversation — no PTY session here.
  if (conversationType !== 'acp') {
    const task = resolveTask(params.projectId, params.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    await withCompensation({
      action: () =>
        task.conversations.startSession(
          conversation,
          params.initialSize,
          false,
          params.initialPrompt
        ),
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
  }

  conversationEvents._emit('conversation:created', conversation);
  events.emit(conversationCreatedChannel, { conversation });
  emitInitialPromptStarted(conversation, params);
  telemetryService.capture('conversation_created', {
    provider: params.provider,
    is_first_in_task: existingConversation === undefined,
    project_id: params.projectId,
    task_id: params.taskId,
    conversation_id: id,
  });

  return conversation;
}
