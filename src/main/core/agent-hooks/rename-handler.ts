import { eq } from 'drizzle-orm';
import { parsePtyId } from '@shared/ptyId';
import { renameConversation } from '@main/core/conversations/renameConversation';
import { renameTask } from '@main/core/tasks/operations/renameTask';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import type { RawHookRequest } from './hook-server';

export interface ConversationRenameResult {
  conversationId: string;
  taskId: string;
  projectId: string;
  title: string;
}

export interface TaskRenameResult {
  taskId: string;
  projectId: string;
  name: string;
}

function parseTitle(raw: RawHookRequest): string {
  let body: Record<string, unknown>;
  try {
    body = raw.body ? JSON.parse(raw.body) : {};
  } catch {
    throw new Error('rename hook: invalid JSON in request body');
  }
  const title = body.title;
  if (!title || typeof title !== 'string') {
    throw new Error('rename hook requires a "title" field in the request body');
  }
  return title;
}

async function lookupConversation(raw: RawHookRequest) {
  const parsed = parsePtyId(raw.ptyId);
  if (!parsed) {
    throw new Error(`Unrecognised ptyId: ${raw.ptyId}`);
  }

  const [conv] = await db
    .select({
      taskId: conversations.taskId,
      projectId: conversations.projectId,
    })
    .from(conversations)
    .where(eq(conversations.id, parsed.conversationId))
    .limit(1);

  if (!conv) {
    throw new Error(`Conversation not found: ${parsed.conversationId}`);
  }

  return { conversationId: parsed.conversationId, ...conv };
}

export async function handleConversationRename(
  raw: RawHookRequest
): Promise<ConversationRenameResult> {
  const title = parseTitle(raw);
  const conv = await lookupConversation(raw);

  await renameConversation(conv.conversationId, title);

  log.info('RenameHandler: conversation renamed via hook', {
    conversationId: conv.conversationId,
    taskId: conv.taskId,
    title,
  });

  return {
    conversationId: conv.conversationId,
    taskId: conv.taskId,
    projectId: conv.projectId,
    title,
  };
}

export async function handleTaskRename(raw: RawHookRequest): Promise<TaskRenameResult> {
  const title = parseTitle(raw);
  const conv = await lookupConversation(raw);

  await renameTask(conv.projectId, conv.taskId, title);

  log.info('RenameHandler: task renamed via hook', {
    taskId: conv.taskId,
    title,
  });

  return {
    taskId: conv.taskId,
    projectId: conv.projectId,
    name: title,
  };
}
