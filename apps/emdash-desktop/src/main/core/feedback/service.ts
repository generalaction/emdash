import { env } from '@main/lib/env';
import { log } from '@main/lib/logger';

// Kept in sync with services/feedback-relay.
const RELAY_SECRET_HEADER = 'x-emdash-feedback-secret';

export interface FeedbackFileInput {
  filename: string;
  mimeType: string;
  bytes: ArrayBuffer;
}

export interface SubmitFeedbackInput {
  content: string;
  files: FeedbackFileInput[];
}

export async function submitFeedback({ content, files }: SubmitFeedbackInput): Promise<void> {
  const relayUrl = env.build.VITE_FEEDBACK_RELAY_URL;
  if (!relayUrl) {
    throw new Error('Feedback relay URL is not configured');
  }

  const formData = new FormData();
  formData.append('content', content);
  files.forEach((file, index) => {
    const blob = new Blob([file.bytes], { type: file.mimeType || 'application/octet-stream' });
    formData.append(`file${index}`, blob, file.filename);
  });

  const headers: Record<string, string> = {};
  const secret = env.build.VITE_FEEDBACK_RELAY_SECRET;
  if (secret) {
    headers[RELAY_SECRET_HEADER] = secret;
  }

  const response = await fetch(relayUrl, { method: 'POST', body: formData, headers });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    log.error('Feedback relay returned an error', { status: response.status, detail });
    throw new Error(`Feedback relay returned ${response.status}`);
  }
}
