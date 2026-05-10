import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { type Conversation, type CreateConversationParams } from '@shared/conversations';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';
import { resolveTask } from '../projects/utils';
import { conversationEvents } from './conversation-events';
import { getProviderSessionCapability } from './provider-session';
import { mapConversationRowToConversation } from './utils';

export async function createConversation(params: CreateConversationParams): Promise<Conversation> {
  const id = params.id ?? randomUUID();
  const [existingConversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.taskId, params.taskId))
    .limit(1);

  const config =
    params.autoApprove === undefined
      ? undefined
      : JSON.stringify({ autoApprove: params.autoApprove });

  // Providers in the session manifest with `acceptsSessionIdFlagAtSpawn`
  // get our UUID — we control their session id at fresh launch. Others
  // (codex, copilot, droid-fresh) generate their own; capture happens
  // post-spawn via the manifest's capture engine.
  const externalSessionId = getProviderSessionCapability(params.provider)
    ?.acceptsSessionIdFlagAtSpawn
    ? id
    : null;

  const [row] = await db
    .insert(conversations)
    .values({
      id,
      projectId: params.projectId,
      taskId: params.taskId,
      title: params.title,
      provider: params.provider,
      config,
      isInitialConversation: params.isInitialConversation ?? false,
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      lastInteractedAt: new Date().toISOString(),
      externalSessionId,
    })
    .returning();

  const task = resolveTask(params.projectId, params.taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  const conversation = mapConversationRowToConversation(row);

  conversationEvents._emit('conversation:created', conversation);

  await task.conversations.startSession(
    conversation,
    params.initialSize,
    false,
    params.initialPrompt
  );
  telemetryService.capture('conversation_created', {
    provider: params.provider,
    is_first_in_task: existingConversation === undefined,
    project_id: params.projectId,
    task_id: params.taskId,
    conversation_id: id,
  });

  return mapConversationRowToConversation(row);
}
