import { env } from '@main/lib/env';

const DEFAULT_FEEDBACK_RELAY_URL = 'https://emdash-feedback-relay.real-general-action.workers.dev';

export interface FeedbackAttachment {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export async function submitFeedbackToRelay(args: {
  content: string;
  files: FeedbackAttachment[];
}): Promise<void> {
  const relayUrl =
    env.dev.FEEDBACK_RELAY_URL ?? env.build.VITE_FEEDBACK_RELAY_URL ?? DEFAULT_FEEDBACK_RELAY_URL;

  const formData = new FormData();
  formData.append('content', args.content);
  args.files.forEach((file, index) => {
    const blob = new Blob([file.bytes.slice().buffer], {
      type: file.mimeType || 'application/octet-stream',
    });
    formData.append(`file${index}`, blob, file.filename);
  });

  const response = await fetch(relayUrl, { method: 'POST', body: formData });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Feedback relay returned ${response.status}${detail ? `: ${detail}` : ''}`);
  }
}
