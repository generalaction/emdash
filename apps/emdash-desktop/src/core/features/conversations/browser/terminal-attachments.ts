import { getConversationsClient } from '@core/features/conversations/api/browser/client';
import { createTerminalAttachmentTarget } from '@core/features/terminals/api/browser/pty/terminal-attachment-target';

/** Capture the conversation receiving the gesture, independent of later pane selection. */
export function createConversationTerminalAttachments(conversationId: string) {
  return createTerminalAttachmentTarget({
    prepareLocalFiles: async (sources, signal) =>
      (await getConversationsClient()).attachments.prepareLocalFiles(
        { conversationId, sources },
        { signal }
      ),
    upload: async (file, signal) =>
      (await getConversationsClient()).attachments.upload({ conversationId }, file, { signal }),
    delete: async (attachmentId) =>
      (await getConversationsClient()).attachments.delete({ conversationId, attachmentId }),
  });
}
