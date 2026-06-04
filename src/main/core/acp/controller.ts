import { createRPCController } from '@shared/ipc/rpc';
import { acpSessionService } from './acp-session-service';

export const acpController = createRPCController({
  sendPrompt: (conversationId: string, prompt: string): Promise<void> =>
    acpSessionService.sendPrompt(conversationId, prompt),
  cancel: (conversationId: string): Promise<void> => acpSessionService.cancel(conversationId),
  respondPermission: (
    conversationId: string,
    requestId: string,
    optionId: string
  ): Promise<void> => {
    acpSessionService.respondPermission(conversationId, requestId, optionId);
    return Promise.resolve();
  },
  getDiagnostics: (conversationId: string): Promise<string> =>
    Promise.resolve(acpSessionService.getDiagnostics(conversationId)),
});
