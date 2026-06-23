import { createRPCController } from '@shared/lib/ipc/rpc';
import type { NativeChatState } from '@shared/native-chat';
import { nativeChatService } from './native-chat-service';
import { readAttachmentImage } from './read-attachment-image';
import { sendNativeChatMessage } from './send-native-chat-message';
import { setNativeChatOptions } from './set-native-chat-options';
import { switchConversationToNativeChat } from './switch-conversation-to-native-chat';
import { switchNativeChatToTerminalMode } from './switch-native-chat-to-terminal-mode';

export const nativeChatController = createRPCController({
  getState: (conversationId: string): Promise<NativeChatState> =>
    nativeChatService.getState(conversationId),

  sendMessage: sendNativeChatMessage,

  interrupt: (conversationId: string): Promise<void> => {
    nativeChatService.interrupt(conversationId);
    return Promise.resolve();
  },

  setOptions: setNativeChatOptions,

  readAttachmentImage,

  switchToTerminal: switchNativeChatToTerminalMode,

  switchToNativeChat: switchConversationToNativeChat,
});
