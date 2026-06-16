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

export const acpController = createRPCController({ prompt, cancel, setModel });
