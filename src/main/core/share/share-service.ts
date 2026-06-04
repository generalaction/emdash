import z from 'zod';
import { withTimeout } from '@shared/result';
import {
  SHARE_MAX_PAYLOAD_BYTES,
  shareFetchResponseSchema,
  sharePayloadSchema,
  type ShareFetchResponse,
  type SharePayload,
  type ShareType,
} from '@shared/share';
import { getShareBaseUrl, SHARE_CONFIG } from './config';

const idPattern = /^[A-Za-z0-9_-]{1,64}$/;

export class ShareService {
  async createShare(payload: SharePayload): Promise<{ id: string; url: string }> {
    const parsedPayload = sharePayloadSchema.parse(payload);
    const shareBaseUrl = getShareBaseUrl();
    const body = JSON.stringify(
      parsedPayload.type === 'skill'
        ? parsedPayload.skill
        : parsedPayload.type === 'automation'
          ? parsedPayload.automation
          : parsedPayload.prompt
    );

    if (new TextEncoder().encode(body).byteLength > SHARE_MAX_PAYLOAD_BYTES) {
      throw new Error('Share payload is too large');
    }

    const response = await withTimeout(
      fetch(`${shareBaseUrl}/api/${typeToPath(parsedPayload.type)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      SHARE_CONFIG.timeoutMs
    );

    if (!response.ok) {
      throw new Error(await readShareError(response, 'Failed to create share link'));
    }

    const result = createShareResponseSchema.parse(await response.json());
    return {
      id: result.id,
      url: `${shareBaseUrl}/${typeToPath(parsedPayload.type)}/${result.id}`,
    };
  }

  async fetchShare(type: ShareType, id: string): Promise<ShareFetchResponse> {
    if (!idPattern.test(id)) {
      throw new Error('Invalid share id');
    }

    const response = await withTimeout(
      fetch(`${getShareBaseUrl()}/api/${typeToPath(type)}/${id}`),
      SHARE_CONFIG.timeoutMs
    );

    if (!response.ok) {
      throw new Error(await readShareError(response, 'Failed to fetch share'));
    }

    const share = shareFetchResponseSchema.parse(await response.json());
    if (share.payload.type !== type) {
      throw new Error('Share type mismatch');
    }
    return share;
  }
}

async function readShareError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
}

function typeToPath(type: ShareType): string {
  if (type === 'skill') return 'skills';
  if (type === 'automation') return 'automations';
  return 'prompts';
}

const createShareResponseSchema = z.object({
  id: z.string().min(1).max(64),
  url: z.string().url(),
});

export const shareService = new ShareService();
