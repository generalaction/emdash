import { randomUUID } from 'node:crypto';
import type { AcpTurn } from '@emdash/core/acp';
import { acpSessionManager } from '@main/core/acp/production-acp-session-manager';
import { createConversation } from '@main/core/conversations/createConversation';
import { getConversationsForTask } from '@main/core/conversations/getConversationsForTask';
import { err, ok, type Result } from '@main/lib/result';
import type { Conversation } from '@shared/core/conversations/conversations';
import { resolveLoopModel, resolveLoopProvider } from '@shared/core/loops/loops';
import {
  phaseConversationTitle,
  verificationConversationTitle,
  type LoopSessionDriver,
  type LoopSessionDriverError,
  type LoopSessionInfo,
  type PromptResult,
  type RestartVerificationSessionContext,
  type StartPhaseSessionContext,
  type StartVerificationSessionContext,
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

async function startConversation(
  ctx: StartPhaseSessionContext | StartVerificationSessionContext,
  title: string
): Promise<Result<LoopSessionInfo, LoopSessionDriverError>> {
  let conversationId = '';
  let conversation: Conversation | null = null;
  const provider = resolveLoopProvider(ctx.loop.config);
  const model = resolveLoopModel(ctx.loop.config) ?? undefined;

  try {
    conversation = await createConversation({
      id: ctx.conversationId ?? randomUUID(),
      projectId: ctx.loop.projectId,
      taskId: ctx.loop.taskId,
      provider,
      title,
      isInitialConversation: false,
      type: 'acp',
      model,
    });
    conversationId = conversation.id;
    acpSessionManager.registerPermissionAutoApproval(conversationId);
  } catch (error) {
    return err({
      kind: 'create-failed',
      message: errorMessage(error, 'Failed to create conversation'),
    });
  }

  if (!conversation) {
    return err({ kind: 'create-failed', message: 'Conversation was not created' });
  }

  const started = await acpSessionManager.start(
    conversation,
    ctx.target.workspaceId,
    ctx.target.path,
    ctx.target.machine,
    undefined,
    ctx.taskEnvironment
  );
  if (!started.success) {
    return err({
      kind: 'hydrate-failed',
      message: errorMessage(started.error, 'Failed to start targeted ACP conversation'),
    });
  }

  return ok({ conversationId, title });
}

async function restartVerificationConversation(
  ctx: RestartVerificationSessionContext
): Promise<Result<LoopSessionInfo, LoopSessionDriverError>> {
  const stopped = acpSessionManager.stop(ctx.conversationId);
  if (!stopped.success) {
    return err({
      kind: 'cancel-failed',
      message: errorMessage(stopped.error, 'Failed to stop stalled ACP verification runtime'),
    });
  }

  let conversation: Conversation | undefined;
  try {
    const conversations = await getConversationsForTask(ctx.loop.projectId, ctx.loop.taskId);
    conversation = conversations.find((candidate) => candidate.id === ctx.conversationId);
  } catch (error) {
    return err({
      kind: 'hydrate-failed',
      message: errorMessage(error, 'Failed to reload stalled ACP verification conversation'),
    });
  }
  if (!conversation || conversation.type !== 'acp') {
    return err({
      kind: 'hydrate-failed',
      message: 'Persisted ACP verification conversation is unavailable for bounded recovery',
    });
  }

  acpSessionManager.registerPermissionAutoApproval(ctx.conversationId);
  const started = await acpSessionManager.start(
    conversation,
    ctx.target.workspaceId,
    ctx.target.path,
    ctx.target.machine,
    undefined,
    ctx.taskEnvironment
  );
  if (!started.success) {
    return err({
      kind: 'hydrate-failed',
      message: errorMessage(started.error, 'Failed to restart stalled ACP verification runtime'),
    });
  }

  return ok({
    conversationId: ctx.conversationId,
    title: verificationConversationTitle(ctx.loop, ctx.phase, ctx.purpose),
  });
}

export const acpLoopSessionDriver: LoopSessionDriver = {
  kind: 'acp',

  async startPhaseSession(
    ctx: StartPhaseSessionContext
  ): Promise<Result<LoopSessionInfo, LoopSessionDriverError>> {
    const title = phaseConversationTitle(ctx.loop, ctx.phase, ctx.purpose);
    return startConversation(ctx, title);
  },

  async startVerificationSession(
    ctx: StartVerificationSessionContext
  ): Promise<Result<LoopSessionInfo, LoopSessionDriverError>> {
    return startConversation(ctx, verificationConversationTitle(ctx.loop, ctx.phase, ctx.purpose));
  },

  restartVerificationSession: restartVerificationConversation,

  async sendPrompt(
    conversationId: string,
    text: string
  ): Promise<Result<PromptResult, LoopSessionDriverError>> {
    acpSessionManager.registerPermissionAutoApproval(conversationId);

    const result = await acpSessionManager.prompt(conversationId, text, undefined, {
      requireRuntime: true,
    });
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
