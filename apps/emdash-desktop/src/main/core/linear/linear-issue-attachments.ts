import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { persistDroppedBlobBytes } from '@main/core/pty/persist-dropped-blob';
import { log } from '@main/lib/logger';
import type { IssueAttachment } from '@shared/issue-providers';

// Files uploaded to Linear are served from uploads.linear.app behind the same
// auth as the GraphQL API, so agents cannot fetch the raw URLs themselves.
const UPLOADS_URL_PATTERN = /https:\/\/uploads\.linear\.app\/[^\s)\]"'<>]+/g;
const MAX_ATTACHMENT_DOWNLOADS = 10;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

/** auth fingerprint + url -> persisted local path, so repeated context fetches reuse downloads. */
const downloadedAttachmentPaths = new Map<string, string>();

export function extractLinearUploadUrls(texts: Array<string | undefined>): string[] {
  const urls = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(UPLOADS_URL_PATTERN)) {
      urls.add(match[0].replace(/[.,;:!?]+$/, ''));
    }
  }
  return [...urls];
}

function attachmentFileName(url: string, identifier: string): string {
  let segment = '';
  try {
    const pathname = new URL(url).pathname;
    segment = decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) ?? '');
  } catch {
    segment = '';
  }
  return segment ? `${identifier}-${segment}` : identifier;
}

async function fetchWithLinearAuth(url: string, token: string): Promise<Response> {
  // Personal API keys are sent verbatim; OAuth tokens require the Bearer scheme.
  const response = await fetch(url, {
    headers: { Authorization: token },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (response.status !== 401 && response.status !== 403) return response;
  return fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
}

function contentLength(response: Response): number | null {
  const header = response.headers.get('content-length');
  if (!header) return null;

  const length = Number(header);
  return Number.isFinite(length) && length >= 0 ? length : null;
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const expectedLength = contentLength(response);
  if (expectedLength !== null && expectedLength > maxBytes) {
    throw new Error(`attachment too large (${expectedLength} bytes)`);
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`attachment too large (${bytes.byteLength} bytes)`);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`attachment too large (${totalBytes} bytes)`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (chunks.length === 1) return chunks[0];

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function downloadAttachment(
  url: string,
  token: string,
  identifier: string
): Promise<string | null> {
  const response = await fetchWithLinearAuth(url, token);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!mimeType.startsWith('image/')) return null;

  const bytes = await readResponseBytes(response, MAX_ATTACHMENT_BYTES);

  return persistDroppedBlobBytes({ bytes, name: attachmentFileName(url, identifier), mimeType });
}

function attachmentCacheKey(url: string, token: string): string {
  return `${createHash('sha256').update(token).digest('hex')}:${url}`;
}

/**
 * Download images referenced via uploads.linear.app in the given texts to
 * local temp files so CLI agents can actually view them. Non-image uploads
 * (e.g. videos) are skipped and stay plain URLs. Failed downloads are logged
 * and omitted instead of failing the issue fetch.
 */
export async function downloadLinearIssueAttachments(args: {
  token: string;
  identifier: string;
  texts: Array<string | undefined>;
}): Promise<IssueAttachment[]> {
  const urls = extractLinearUploadUrls(args.texts);
  if (urls.length > MAX_ATTACHMENT_DOWNLOADS) {
    log.warn('[Linear] skipping attachment downloads beyond limit', {
      identifier: args.identifier,
      total: urls.length,
      limit: MAX_ATTACHMENT_DOWNLOADS,
    });
  }

  const attachments = await Promise.all(
    urls.slice(0, MAX_ATTACHMENT_DOWNLOADS).map(async (url): Promise<IssueAttachment | null> => {
      const cacheKey = attachmentCacheKey(url, args.token);
      const cached = downloadedAttachmentPaths.get(cacheKey);
      if (cached && existsSync(cached)) return { url, localPath: cached };

      try {
        const localPath = await downloadAttachment(url, args.token, args.identifier);
        if (!localPath) return null;
        downloadedAttachmentPaths.set(cacheKey, localPath);
        return { url, localPath };
      } catch (error) {
        log.warn('[Linear] failed to download issue attachment:', { url, error });
        return null;
      }
    })
  );

  return attachments.filter((attachment): attachment is IssueAttachment => attachment !== null);
}
