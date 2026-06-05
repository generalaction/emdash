import { basename } from 'node:path';
import type { NativeChatAttachment } from '@shared/native-chat';

/** Validate untrusted attachment input from the renderer. Throws on bad data. */
export function validateAttachments(
  attachments: NativeChatAttachment[] | undefined
): NativeChatAttachment[] {
  if (!attachments?.length) return [];
  return attachments.map((attachment) => {
    const path = attachment.path;
    if (typeof path !== 'string' || !path.trim() || path.includes('\0') || path.length > 4096) {
      throw new Error('Invalid attachment path');
    }
    if (attachment.kind !== 'image' && attachment.kind !== 'file') {
      throw new Error(`Invalid attachment kind: ${String(attachment.kind)}`);
    }
    return {
      path,
      kind: attachment.kind,
      ...(typeof attachment.name === 'string' && attachment.name.trim()
        ? { name: attachment.name }
        : {}),
    };
  });
}

export function attachmentDisplayName(attachment: NativeChatAttachment): string {
  return attachment.name?.trim() || basename(attachment.path);
}

/**
 * Append attachment paths to the prompt for the agent to read from disk.
 * Codex images are passed via `-i` instead and should be excluded by the
 * caller; Claude reads both files and images through its Read tool.
 */
export function buildPromptWithAttachments(
  prompt: string,
  attachments: NativeChatAttachment[]
): string {
  if (attachments.length === 0) return prompt;
  const lines = attachments.map((attachment) => `- ${attachment.path}`);
  const base = prompt || 'Look at the attached files.';
  return `${base}\n\nAttached files (read them from disk):\n${lines.join('\n')}`;
}
