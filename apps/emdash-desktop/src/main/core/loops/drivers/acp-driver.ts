import { randomUUID } from 'node:crypto';
import type { AcpTurn } from '@emdash/core/acp';
import { acpSessionManager } from '@main/core/acp/production-acp-session-manager';
import { createConversation } from '@main/core/conversations/createConversation';
import { hydrateConversation } from '@main/core/conversations/hydrateConversation';
import { err, ok, type Result } from '@main/lib/result';
import {
  phaseConversationTitle,
  type LoopSessionDriver,
  type LoopSessionDriverError,
  type LoopSessionInfo,
  type PromptResult,
  type StartPhaseSessionContext,
} from './session-driver';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
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
      return err({ kind: 'create-failed', message: errorMessage(error) });
    }

    try {
      await hydrateConversation(ctx.loop.projectId, ctx.loop.taskId, conversationId);
    } catch (error) {
      return err({ kind: 'hydrate-failed', message: errorMessage(error) });
    }

    return ok({ conversationId, title });
  },

  async sendPrompt(
    conversationId: string,
    text: string
  ): Promise<Result<PromptResult, LoopSessionDriverError>> {
    const result = await acpSessionManager.prompt(conversationId, text);
    if (!result.success) {
      return err({ kind: 'prompt-failed', message: errorMessage(result.error) });
    }

    return ok({ finalText: finalAssistantText(conversationId) });
  },

  async cancelPrompt(conversationId: string): Promise<Result<void, LoopSessionDriverError>> {
    const result = await acpSessionManager.cancel(conversationId);
    if (!result.success) {
      return err({ kind: 'cancel-failed', message: errorMessage(result.error) });
    }
    return ok();
  },
};
