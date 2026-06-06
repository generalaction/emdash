import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { log } from '@main/lib/logger';
import type { NativeChatItem } from '@shared/native-chat';

/**
 * On-disk transcript for one native chat conversation, so the chat body
 * survives app restarts. One JSON file per conversation under userData;
 * deliberately not the SQLite database — transcripts are bulky, append-mostly,
 * and disposable relative to conversation rows.
 */
export type PersistedNativeChatTranscript = {
  version: 1;
  providerId: string;
  items: NativeChatItem[];
  /** Highest turn sequence used, so new turn keys never collide after a restart. */
  turnSeq: number;
  turnDurationsMs: Record<string, number>;
  threadId?: string;
};

const TRANSCRIPT_VERSION = 1;
const SAFE_CONVERSATION_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

function transcriptsDir(): string {
  return join(app.getPath('userData'), 'native-chat-transcripts');
}

function transcriptFile(conversationId: string): string | null {
  if (!SAFE_CONVERSATION_ID_PATTERN.test(conversationId)) return null;
  return join(transcriptsDir(), `${conversationId}.json`);
}

export async function loadNativeChatTranscript(
  conversationId: string
): Promise<PersistedNativeChatTranscript | null> {
  const file = transcriptFile(conversationId);
  if (!file) return null;
  try {
    const raw = await readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== TRANSCRIPT_VERSION ||
      !Array.isArray((parsed as { items?: unknown }).items)
    ) {
      return null;
    }
    const record = parsed as PersistedNativeChatTranscript;
    return {
      version: TRANSCRIPT_VERSION,
      providerId: typeof record.providerId === 'string' ? record.providerId : '',
      items: record.items,
      turnSeq: typeof record.turnSeq === 'number' ? record.turnSeq : 0,
      turnDurationsMs:
        typeof record.turnDurationsMs === 'object' && record.turnDurationsMs !== null
          ? record.turnDurationsMs
          : {},
      ...(typeof record.threadId === 'string' ? { threadId: record.threadId } : {}),
    };
  } catch {
    return null;
  }
}

export async function saveNativeChatTranscript(
  conversationId: string,
  transcript: PersistedNativeChatTranscript
): Promise<void> {
  const file = transcriptFile(conversationId);
  if (!file) return;
  try {
    await mkdir(transcriptsDir(), { recursive: true });
    // Atomic write: a crash mid-save must not corrupt the previous transcript.
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(transcript), 'utf8');
    await rename(tmp, file);
  } catch (error) {
    log.warn('native-chat: failed to persist transcript', {
      conversationId,
      error: String(error),
    });
  }
}

export async function deleteNativeChatTranscript(conversationId: string): Promise<void> {
  const file = transcriptFile(conversationId);
  if (!file) return;
  await rm(file, { force: true }).catch(() => {});
}
