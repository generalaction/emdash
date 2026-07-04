import type { AcpRuntimeError, TerminalSnapshot } from '@emdash/core/acp';
import type { Result } from '@emdash/shared';
import type { AcpPromptImage, ChatHistory, SessionState } from '@shared/core/acp/acpTurns';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { acpSessionManager } from './production-acp-session-manager';

async function prompt(
  conversationId: string,
  text: string,
  images?: AcpPromptImage[]
): Promise<Result<void, AcpRuntimeError>> {
  return acpSessionManager.prompt(conversationId, text, images);
}

async function cancel(conversationId: string): Promise<Result<void, AcpRuntimeError>> {
  return acpSessionManager.cancel(conversationId);
}

async function setModel(
  conversationId: string,
  model: string
): Promise<Result<void, AcpRuntimeError>> {
  return acpSessionManager.setModel(conversationId, model);
}

async function setMode(
  conversationId: string,
  modeId: string
): Promise<Result<void, AcpRuntimeError>> {
  return acpSessionManager.setMode(conversationId, modeId);
}

async function setConfigOption(
  conversationId: string,
  configId: string,
  value: string
): Promise<Result<void, AcpRuntimeError>> {
  return acpSessionManager.setConfigOption(conversationId, configId, value);
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
  optionId: string
): Promise<Result<void, AcpRuntimeError>> {
  return Promise.resolve(acpSessionManager.resolvePermission(conversationId, requestId, optionId));
}

function getTerminals(conversationId: string): Promise<TerminalSnapshot[]> {
  return Promise.resolve(acpSessionManager.getTerminals(conversationId));
}

export const acpController = createRPCController({
  prompt,
  cancel,
  setModel,
  setMode,
  setConfigOption,
  getChatHistory,
  getSessionState,
  resolvePermission,
  getTerminals,
});
