import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { nativeChatService } from '@main/core/native-chat/native-chat-service';
import { resolveNativeChatTarget } from '@main/core/native-chat/resolve-native-chat-target';
import { appSettingsService } from '@main/core/settings/settings-service';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { withCompensation } from '@main/core/utils/compensation';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { serializeConversationConfig, type ConversationConfig } from '@shared/conversation-config';
import { isNativeChatProvider } from '@shared/conversation-ui';
import { type Conversation, type CreateConversationParams } from '@shared/conversations';
import { agentEventChannel, type AgentEvent } from '@shared/events/agentEvents';
import { conversationCreatedChannel } from '@shared/events/conversationEvents';
import { isAppFocused } from '../agent-hooks/notification';
import { resolveTask } from '../projects/utils';
import { applyNativeChatDefaults } from './apply-native-chat-defaults';
import { conversationEvents } from './conversation-events';
import { resolveConversationUiMode } from './resolve-conversation-ui-mode';
import { mapConversationRowToConversation } from './utils';

type ConversationCreateDb = Pick<typeof db, 'delete' | 'insert' | 'select'>;

function emitInitialPromptStarted(
  conversation: Conversation,
  params: CreateConversationParams
): void {
  if (!params.initialPrompt?.trim()) return;

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
  events.emit(agentEventChannel, { event: agentEvent, appFocused: isAppFocused() });
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

  const uiMode = resolveConversationUiMode({
    providerId: params.provider,
    conversationUi: await appSettingsService.get('conversationUi'),
    isRemoteTask: Boolean(taskSessionManager.getPersistData(params.taskId)?.sshConnectionId),
  });

  const configObj: ConversationConfig = {};
  if (params.autoApprove !== undefined) configObj.autoApprove = params.autoApprove;
  if (uiMode === 'native-chat') {
    configObj.uiMode = 'native-chat';
    if (isNativeChatProvider(params.provider)) {
      applyNativeChatDefaults(
        configObj,
        (await appSettingsService.get('nativeChatDefaults'))[params.provider]
      );
    }
  }
  const config =
    Object.keys(configObj).length > 0 ? serializeConversationConfig(configObj) : undefined;

  const [row] = await database
    .insert(conversations)
    .values({
      id,
      projectId: params.projectId,
      taskId: params.taskId,
      title: params.title,
      provider: params.provider,
      config,
      sessionId: id,
      isInitialConversation: params.isInitialConversation ?? false,
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      lastInteractedAt: new Date().toISOString(),
    })
    .returning();

  const task = resolveTask(params.projectId, params.taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  const conversation = mapConversationRowToConversation(row);

  await withCompensation({
    action: async () => {
      if (uiMode === 'native-chat') {
        // Native chat has no PTY session — the first turn (if any) runs
        // through `codex exec` and follow-ups arrive via the chat composer.
        if (params.initialPrompt?.trim()) {
          const target = resolveNativeChatTarget(params.taskId);
          await nativeChatService.startTurn({
            conversation,
            cwd: target.cwd,
            taskEnvVars: target.taskEnvVars,
            prompt: params.initialPrompt,
          });
        }
        return;
      }
      await task.conversations.startSession(
        conversation,
        params.initialSize,
        false,
        params.initialPrompt
      );
    },
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

  conversationEvents._emit('conversation:created', conversation);
  events.emit(conversationCreatedChannel, { conversation });
  // Native chat emits its own 'start' agent event per turn from the service.
  if (uiMode !== 'native-chat') emitInitialPromptStarted(conversation, params);
  telemetryService.capture('conversation_created', {
    provider: params.provider,
    is_first_in_task: existingConversation === undefined,
    project_id: params.projectId,
    task_id: params.taskId,
    conversation_id: id,
  });

  return conversation;
}
