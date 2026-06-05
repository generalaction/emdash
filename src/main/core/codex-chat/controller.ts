import { createRPCController } from '@shared/ipc/rpc';
import type { CodexChatState } from '@shared/native-chat';
import { codexChatService } from './codex-chat-service';
import { sendCodexChatMessage } from './send-codex-chat-message';
import { setCodexChatOptions } from './set-codex-chat-options';
import { switchCodexChatToNative } from './switch-codex-chat-to-native';
import { switchCodexChatToTerminal } from './switch-codex-chat-to-terminal';

export const codexChatController = createRPCController({
  getState: (conversationId: string): Promise<CodexChatState> =>
    Promise.resolve(codexChatService.getState(conversationId)),

  sendMessage: sendCodexChatMessage,

  interrupt: (conversationId: string): Promise<void> => {
    codexChatService.interrupt(conversationId);
    return Promise.resolve();
  },

  setOptions: setCodexChatOptions,

  switchToTerminal: switchCodexChatToTerminal,

  switchToNativeChat: switchCodexChatToNative,
});
