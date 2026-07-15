import { KeyedMutex } from '@emdash/core/primitives/concurrency/api';
import { and, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { conversationChangedChannel } from '@shared/core/conversations/conversationEvents';
import type { Conversation } from '@shared/core/conversations/conversations';
import { resolveTask } from '../projects/utils';
import { setSessionIdIfUnset } from './set-session-id';
import type { EnsureConversationSessionOutcome } from './types';
import { mapConversationRowToConversation } from './utils';

type LaunchTuiConversationDb = Pick<typeof db, 'select' | 'update'>;

export type LaunchTuiConversationInput = {
  projectId: string;
  taskId: string;
  conversationId: string;
  initialSize?: { cols: number; rows: number };
  database?: LaunchTuiConversationDb;
};

export type LaunchTuiConversationResult = {
  conversation: Conversation;
  outcome: EnsureConversationSessionOutcome;
};

const launchMutex = new KeyedMutex();

export async function launchTuiConversation({
  projectId,
  taskId,
  conversationId,
  initialSize,
  database = db,
}: LaunchTuiConversationInput): Promise<LaunchTuiConversationResult> {
  return launchMutex.runExclusive(conversationId, async () => {
    const [row] = await database
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.projectId, projectId),
          eq(conversations.taskId, taskId)
        )
      )
      .limit(1);

    if (!row) throw new Error('Conversation not found');
    if (row.type === 'acp') {
      return { conversation: mapConversationRowToConversation(row), outcome: 'attached' };
    }

    const task = resolveTask(projectId, taskId);
    if (!task) throw new Error('Task not found');

    const isFirstSpawn = row.sessionId === null;
    const conversation = mapConversationRowToConversation(row);
    const initialPrompt =
      isFirstSpawn && row.config?.type === 'pty' ? row.config.initialPrompt : undefined;

    const launched = await task.conversations.ensureSession({
      conversation,
      mode: isFirstSpawn ? 'start' : 'resume',
      initialSize,
      initialPrompt,
    });

    if (launched.outcome !== 'attached') {
      telemetryService.capture('agent_run_started', {
        provider: conversation.providerId,
        project_id: conversation.projectId,
        task_id: conversation.taskId,
        conversation_id: conversation.id,
      });
    }

    if (!isFirstSpawn || launched.outcome === 'attached') {
      return { conversation, outcome: launched.outcome };
    }

    const persisted = await setSessionIdIfUnset(conversationId, conversationId, database);
    if (!persisted.success) {
      await task.conversations.stopSession(conversationId);
      throw new Error(`Failed to persist PTY session id: ${JSON.stringify(persisted.error)}`);
    }

    if (persisted.data.updated) {
      events.emit(conversationChangedChannel, {
        conversationId,
        taskId,
        projectId,
        changes: { sessionId: persisted.data.sessionId },
      });
    } else if (persisted.data.sessionId !== conversationId) {
      log.debug('launchTuiConversation: native session id won placeholder race', {
        conversationId,
        sessionId: persisted.data.sessionId,
      });
    }

    return {
      conversation: { ...conversation, sessionId: persisted.data.sessionId },
      outcome: launched.outcome,
    };
  });
}
