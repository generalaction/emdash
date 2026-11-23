import { toast } from '@emdash/ui/react/primitives';
import { toAcpImageAttachmentMimeType } from '@core/features/conversations/api/browser/acp-image-attachment';
import { getConversationsClient } from '@core/features/conversations/api/browser/client';
import type { InitialImageAttachment } from '@core/features/tasks/contributions/browser/task-config/initial-conversation-section';
import type { TaskConfig } from '@core/primitives/tasks/api';

/** Deliver the first ACP message after its conversation and workspace exist. */
export async function sendInitialImages(
  conversation: NonNullable<TaskConfig['initialConversation']>,
  images: InitialImageAttachment[],
  text: string
): Promise<void> {
  const client = await getConversationsClient();
  const attachments = await Promise.all(
    images.map(async ({ file }) => {
      const mimeType = toAcpImageAttachmentMimeType(file);
      if (!mimeType) return null;
      try {
        const result = await client.attachments.upload(
          { conversationId: conversation.id },
          { name: file.name || 'image', mimeType, size: file.size, source: file.stream() }
        );
        return result.success
          ? { type: 'attachment' as const, id: result.data.id, mimeType, name: result.data.name }
          : null;
      } catch {
        return null;
      }
    })
  );
  const uploaded = attachments.filter((attachment) => attachment !== null);
  if (uploaded.length !== images.length) {
    toast.error('Some images could not be attached', {
      description: 'Open the conversation to add the missing images.',
    });
  }

  const prompt = conversation.initialQueue?.[0] ?? { text };
  if (!prompt.text.trim() && uploaded.length === 0) return;

  const key = { conversationId: conversation.id };
  const attached = await client.acp.attach(key);
  if (!attached.success) throw new Error('Could not attach the initial conversation');
  const started = await client.acp.startSession({
    ...key,
    mode: attached.data.sessionId ? 'resume' : 'fresh',
  });
  if (!started.success) throw new Error('Could not start the initial conversation');
  const sent = await client.acp.sendPrompt(
    { ...key, promptId: crypto.randomUUID(), prompt: { ...prompt, attachments: uploaded } },
    { timeoutMs: 0 }
  );
  if (!sent.success) throw new Error('Could not send the initial message');
}
