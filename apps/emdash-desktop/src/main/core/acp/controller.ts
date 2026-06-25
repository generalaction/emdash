import type { TerminalSnapshot } from '@emdash/core/acp';
import type { AcpPromptImage, ChatHistory, SessionState } from '@shared/core/acp/acpTurns';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { acpSessionManager } from './production-acp-session-manager';

async function prompt(
  conversationId: string,
  text: string,
  images?: AcpPromptImage[]
): Promise<void> {
  await acpSessionManager.prompt(conversationId, text, images);
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

function resolvePermission(
  conversationId: string,
  requestId: string,
  optionId: string | null
): Promise<void> {
  acpSessionManager.resolvePermission(conversationId, requestId, optionId);
  return Promise.resolve();
}

function getTerminals(conversationId: string): Promise<TerminalSnapshot[]> {
  return Promise.resolve(acpSessionManager.getTerminals(conversationId));
}

export const acpController = createRPCController({
  prompt,
  cancel,
  setModel,
  getChatHistory,
  getSessionState,
  resolvePermission,
  getTerminals,
});
