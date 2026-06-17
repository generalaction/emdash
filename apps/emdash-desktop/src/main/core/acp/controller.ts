import type { SessionUpdate } from '@agentclientprotocol/sdk';
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

function getSessionStatus(conversationId: string): Promise<'ready' | 'starting' | 'none'> {
  return Promise.resolve(acpSessionManager.getSessionStatus(conversationId));
}

function getTranscript(
  conversationId: string
): Promise<{ seq: number; update: SessionUpdate }[]> {
  return Promise.resolve(acpSessionManager.getTranscript(conversationId));
}

export const acpController = createRPCController({
  prompt,
  cancel,
  setModel,
  getSessionStatus,
  getTranscript,
});
