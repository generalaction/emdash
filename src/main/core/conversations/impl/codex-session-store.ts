import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import type { Conversation } from '@shared/conversations';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { saveConversationProviderSessionId } from '../provider-session-id';

type CodexThreadRow = {
  id: string;
  created_at_ms?: number;
};

type CodexConversationRow = {
  id: string;
  config: string | null;
  createdAt: string;
};

type PendingCodexSession = {
  conversationId: string;
  cwd: string;
  startedAtMs: number;
  firstUserMessage?: string;
  input: string;
  captured: boolean;
  captureScheduled: boolean;
};

const pendingCodexSessions = new Map<string, PendingCodexSession>();
const claimedCodexThreadIds = new Set<string>();
const CAPTURE_START_TOLERANCE_MS = 5_000;
const CAPTURE_RETRY_DELAYS_MS = [250, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000];

function existingProviderSessionIds(): Set<string> {
  const ids = new Set<string>(claimedCodexThreadIds);
  for (const row of db.select({ config: conversations.config }).from(conversations).all()) {
    if (!row.config) continue;
    try {
      const id = JSON.parse(row.config).providerSessionId;
      if (typeof id === 'string' && id) ids.add(id);
    } catch {
      // Ignore malformed historical config; normal conversation hydration handles it separately.
    }
  }
  return ids;
}

function openCodexDb(): Database.Database | undefined {
  const statePath = join(homedir(), '.codex', 'state_5.sqlite');
  if (!existsSync(statePath)) return undefined;

  return new Database(statePath, { readonly: true, fileMustExist: true });
}

function readConfigProviderSessionId(config: string | null): string | undefined {
  if (!config) return undefined;
  try {
    const id = JSON.parse(config).providerSessionId;
    return typeof id === 'string' && id ? id : undefined;
  } catch {
    return undefined;
  }
}

function providerSessionIdIsUnique(rows: CodexConversationRow[], sessionId: string): boolean {
  return rows.filter((row) => readConfigProviderSessionId(row.config) === sessionId).length === 1;
}

function parseCreatedAtMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function resolveCodexSessionIdForResume(
  conversation: Conversation,
  cwd: string
): Promise<string | undefined> {
  const rows = (await db
    .select({
      id: conversations.id,
      config: conversations.config,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(
      and(eq(conversations.taskId, conversation.taskId), eq(conversations.provider, 'codex'))
    )) as CodexConversationRow[];

  const codexRows = rows.sort((a, b) => {
    const timeDelta = parseCreatedAtMs(a.createdAt) - parseCreatedAtMs(b.createdAt);
    return timeDelta === 0 ? a.id.localeCompare(b.id) : timeDelta;
  });

  if (
    conversation.providerSessionId &&
    providerSessionIdIsUnique(codexRows, conversation.providerSessionId)
  ) {
    return conversation.providerSessionId;
  }

  const conversationIndex = codexRows.findIndex((row) => row.id === conversation.id);
  if (conversationIndex < 0) return conversation.providerSessionId;

  let codexDb: Database.Database | undefined;
  try {
    codexDb = openCodexDb();
    if (!codexDb) return conversation.providerSessionId;

    const firstCreatedAtMs = Math.max(0, parseCreatedAtMs(codexRows[0]?.createdAt ?? '') - 60_000);
    const threads = codexDb
      .prepare(
        `SELECT id, created_at_ms
         FROM threads
         WHERE archived = 0
           AND cwd = ?
           AND created_at_ms >= ?
         ORDER BY created_at_ms ASC, id ASC
         LIMIT 100`
      )
      .all(cwd, firstCreatedAtMs) as CodexThreadRow[];

    const providerSessionId = threads[conversationIndex]?.id;
    if (!providerSessionId) return conversation.providerSessionId;

    conversation.providerSessionId = providerSessionId;
    await saveConversationProviderSessionId(conversation.id, providerSessionId);
    return providerSessionId;
  } catch (error) {
    log.debug('CodexSessionStore: failed to resolve Codex session id for resume', {
      conversationId: conversation.id,
      error: String(error),
    });
    return conversation.providerSessionId;
  } finally {
    codexDb?.close();
  }
}

function findCodexThread(params: {
  cwd: string;
  startedAtMs: number;
  firstUserMessage?: string;
}): string | undefined {
  let codexDb: Database.Database | undefined;
  try {
    codexDb = openCodexDb();
    if (!codexDb) return undefined;

    const assignedIds = existingProviderSessionIds();
    const minCreatedAtMs = params.startedAtMs - CAPTURE_START_TOLERANCE_MS;
    const rows = params.firstUserMessage
      ? (codexDb
          .prepare(
            `SELECT id
             FROM threads
             WHERE archived = 0
               AND cwd = ?
               AND created_at_ms >= ?
               AND first_user_message = ?
             ORDER BY created_at_ms ASC, id ASC
             LIMIT 10`
          )
          .all(params.cwd, minCreatedAtMs, params.firstUserMessage) as CodexThreadRow[])
      : (codexDb
          .prepare(
            `SELECT id
             FROM threads
             WHERE archived = 0
               AND cwd = ?
               AND created_at_ms >= ?
             ORDER BY created_at_ms ASC, id ASC
             LIMIT 10`
          )
          .all(params.cwd, minCreatedAtMs) as CodexThreadRow[]);

    return rows.find((row) => !assignedIds.has(row.id))?.id;
  } catch (error) {
    log.debug('CodexSessionStore: failed to match Codex thread', {
      error: String(error),
    });
    return undefined;
  } finally {
    codexDb?.close();
  }
}

async function claimCodexThread(ptySessionId: string, providerSessionId: string): Promise<void> {
  const pending = pendingCodexSessions.get(ptySessionId);
  if (!pending || pending.captured || claimedCodexThreadIds.has(providerSessionId)) return;

  pending.captured = true;
  claimedCodexThreadIds.add(providerSessionId);
  try {
    await saveConversationProviderSessionId(pending.conversationId, providerSessionId);
    pendingCodexSessions.delete(ptySessionId);
  } catch (error) {
    pending.captured = false;
    throw error;
  } finally {
    claimedCodexThreadIds.delete(providerSessionId);
  }
}

function scheduleCodexThreadCapture(ptySessionId: string, firstUserMessage?: string): void {
  const pending = pendingCodexSessions.get(ptySessionId);
  if (!pending || pending.captured) return;
  if (firstUserMessage) pending.firstUserMessage = firstUserMessage;
  if (pending.captureScheduled) return;

  pending.captureScheduled = true;

  const tryCapture = async () => {
    const pending = pendingCodexSessions.get(ptySessionId);
    if (!pending || pending.captured) return;

    const providerSessionId = findCodexThread({
      cwd: pending.cwd,
      startedAtMs: pending.startedAtMs,
      firstUserMessage: pending.firstUserMessage,
    });
    if (providerSessionId) await claimCodexThread(ptySessionId, providerSessionId);
  };

  for (const delayMs of CAPTURE_RETRY_DELAYS_MS) {
    setTimeout(() => {
      tryCapture().catch((error) => {
        log.debug('CodexSessionStore: failed to capture Codex thread', {
          error: String(error),
        });
      });
    }, delayMs);
  }
}

export function registerPendingCodexSession(params: {
  ptySessionId: string;
  conversationId: string;
  cwd: string;
  startedAtMs: number;
  firstUserMessage?: string;
}): void {
  pendingCodexSessions.set(params.ptySessionId, {
    conversationId: params.conversationId,
    cwd: params.cwd,
    startedAtMs: params.startedAtMs,
    firstUserMessage: params.firstUserMessage?.trim() || undefined,
    input: '',
    captured: false,
    captureScheduled: false,
  });
  scheduleCodexThreadCapture(params.ptySessionId, params.firstUserMessage?.trim() || undefined);
}

export function unregisterPendingCodexSession(ptySessionId: string): void {
  pendingCodexSessions.delete(ptySessionId);
}

export function recordCodexInput(ptySessionId: string, data: string): void {
  const pending = pendingCodexSessions.get(ptySessionId);
  if (!pending || pending.captured) return;

  for (const char of data) {
    if (char === '\r' || char === '\n') {
      const firstUserMessage = pending.input.trim();
      pending.input = '';
      if (firstUserMessage) scheduleCodexThreadCapture(ptySessionId, firstUserMessage);
      continue;
    }
    if (char === '\u007f' || char === '\b') {
      pending.input = pending.input.slice(0, -1);
      continue;
    }
    if (char >= ' ') pending.input += char;
  }
}
