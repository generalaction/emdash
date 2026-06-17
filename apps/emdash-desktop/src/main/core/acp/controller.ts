import type { ChatHistory, SessionState } from '@shared/core/acp/acpTurns';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { acpSessionManager } from './acp-session-manager';

async function prompt(conversationId: string, text: string): Promise<void> {
  await acpSessionManager.prompt(conversationId, text);
}

async function cancel(conversationId: string): Promise<void> {
  await acpSessionManager.cancel(conversationId);
}

async function setModel(conversationId: string, model: string): Promise<void> {
  await acpSessionManager.setModel(conversationId, model);
}

function getChatHistory(conversationId: string): Promise<ChatHistory> {
  return Promise.resolve(acpSessionManager.getChatHistory(conversationId));
}

function getSessionState(conversationId: string): Promise<SessionState> {
  return Promise.resolve(acpSessionManager.getSessionState(conversationId));
}

export const acpController = createRPCController({
  prompt,
  cancel,
  setModel,
  getChatHistory,
  getSessionState,
});
