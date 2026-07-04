import { randomUUID } from 'node:crypto';
import type { AcpTurn } from '@emdash/core/acp';
import { eq } from 'drizzle-orm';
import { acpSessionManager } from '@main/core/acp/production-acp-session-manager';
import { createConversation } from '@main/core/conversations/createConversation';
import { hydrateConversation } from '@main/core/conversations/hydrateConversation';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { err, ok, type Result } from '@main/lib/result';
import {
  phaseConversationTitle,
  type LoopSessionDriver,
  type LoopSessionDriverError,
  type LoopSessionInfo,
  type PromptResult,
  type StartPhaseSessionContext,
} from './session-driver';

function isMeaningfulMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized !== '' && normalized !== 'undefined' && normalized !== 'null';
}

function errorMessage(error: unknown, fallback = 'ACP loop request failed'): string {
  if (error instanceof Error && isMeaningfulMessage(error.message)) return error.message;
  if (typeof error === 'string' && isMeaningfulMessage(error)) return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && isMeaningfulMessage(message)) return message;
  }
  if (typeof error === 'object' && error !== null && 'cause' in error) {
    const causeMessage = errorMessage((error as { cause?: unknown }).cause, '');
    if (causeMessage) return causeMessage;
  }
  if (typeof error === 'object' && error !== null && 'type' in error) {
    const type = (error as { type?: unknown }).type;
    if (typeof type === 'string' && type.trim()) return `ACP error: ${type}`;
  }
  if (typeof error === 'object' && error !== null && 'kind' in error) {
    const kind = (error as { kind?: unknown }).kind;
    if (typeof kind === 'string' && kind.trim()) return `ACP error: ${kind}`;
  }
  return fallback;
}

function hasErrorType(error: unknown, type: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type?: unknown }).type === type
  );
}

function assistantTextFromTurn(turn: AcpTurn): string {
  return turn.updates
    .map(({ update }) =>
      update.kind === 'message' && update.role === 'assistant' ? update.text : ''
    )
    .filter(Boolean)
    .join('');
}

function finalAssistantText(conversationId: string): string {
  const history = acpSessionManager.getChatHistory(conversationId);
  for (let index = history.turns.length - 1; index >= 0; index -= 1) {
    const text = assistantTextFromTurn(history.turns[index]!);
    if (text.trim()) return text;
  }
  return '';
}

async function hydrateConversationById(
  conversationId: string
): Promise<Result<void, LoopSessionDriverError>> {
  try {
    const [row] = await db
      .select({
        projectId: conversations.projectId,
        taskId: conversations.taskId,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!row) {
      return err({ kind: 'hydrate-failed', message: 'Conversation not found' });
    }

    await hydrateConversation(row.projectId, row.taskId, conversationId);
    return ok();
  } catch (error) {
    return err({
      kind: 'hydrate-failed',
      message: errorMessage(error, 'Failed to hydrate ACP conversation'),
    });
  }
}

export const acpLoopSessionDriver: LoopSessionDriver = {
  kind: 'acp',

  async startPhaseSession(
    ctx: StartPhaseSessionContext
  ): Promise<Result<LoopSessionInfo, LoopSessionDriverError>> {
    const title = phaseConversationTitle(ctx.loop, ctx.phase, ctx.review);
    let conversationId = '';

    try {
      const conversation = await createConversation({
        id: randomUUID(),
        projectId: ctx.loop.projectId,
        taskId: ctx.loop.taskId,
        provider: 'claude',
        title,
        isInitialConversation: false,
        type: 'acp',
      });
      conversationId = conversation.id;
    } catch (error) {
      return err({
        kind: 'create-failed',
        message: errorMessage(error, 'Failed to create conversation'),
      });
    }

    try {
      await hydrateConversation(ctx.loop.projectId, ctx.loop.taskId, conversationId);
    } catch (error) {
      return err({
        kind: 'hydrate-failed',
        message: errorMessage(error, 'Failed to hydrate ACP conversation'),
      });
    }

    return ok({ conversationId, title });
  },

  async sendPrompt(
    conversationId: string,
    text: string
  ): Promise<Result<PromptResult, LoopSessionDriverError>> {
    let result = await acpSessionManager.prompt(conversationId, text, undefined, {
      requireRuntime: true,
    });
    if (!result.success && hasErrorType(result.error, 'conversation_not_found')) {
      const hydrated = await hydrateConversationById(conversationId);
      if (!hydrated.success) return hydrated;
      result = await acpSessionManager.prompt(conversationId, text, undefined, {
        requireRuntime: true,
      });
    }
    if (!result.success) {
      return err({
        kind: 'prompt-failed',
        message: errorMessage(result.error, 'ACP prompt failed'),
      });
    }

    return ok({ finalText: finalAssistantText(conversationId) });
  },

  async cancelPrompt(conversationId: string): Promise<Result<void, LoopSessionDriverError>> {
    const result = await acpSessionManager.cancel(conversationId, { requireRuntime: true });
    if (!result.success) {
      return err({
        kind: 'cancel-failed',
        message: errorMessage(result.error, 'ACP cancel failed'),
      });
    }
    return ok();
  },
};
