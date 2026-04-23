import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { conversations, tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import {
  isUniqueConstraintError,
  readLegacyRows,
  toIsoTimestamp,
  toTrimmedString,
} from './helpers';
import { createPortSummary, type PortContext, type PortSummary } from './types';

const LEGACY_PTY_SESSION_MAP_FILE = 'pty-session-map.json';
const LEGACY_CLAUDE_CHAT_PREFIX = 'claude-chat-';
const LEGACY_CLAUDE_MAIN_PREFIX = 'claude-main-';
const LEGACY_OPTIMISTIC_TASK_PREFIX = 'optimistic-';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONVERSATION_ID_TIMESTAMP_PATTERN = /-(\d{10,})$/;
const MAX_OPTIMISTIC_MAIN_TIMESTAMP_DRIFT_MS = 5_000;

type LegacyPtySessionMapEntry = {
  uuid?: unknown;
  resumeTarget?: unknown;
};

type LegacyClaudeResumeTargets = {
  chatConversationIdToUuid: Map<string, string>;
  mainTaskIdToUuid: Map<string, string>;
  optimisticMainByTimestamp: Array<{ timestampMs: number; resumeUuid: string }>;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidResumeUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function readLegacyClaudeResumeTargets(userDataPath?: string): LegacyClaudeResumeTargets {
  const targets: LegacyClaudeResumeTargets = {
    chatConversationIdToUuid: new Map<string, string>(),
    mainTaskIdToUuid: new Map<string, string>(),
    optimisticMainByTimestamp: [],
  };

  if (!userDataPath) return targets;

  const mapPath = join(userDataPath, LEGACY_PTY_SESSION_MAP_FILE);
  if (!existsSync(mapPath)) return targets;

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(readFileSync(mapPath, 'utf8')) as unknown;
  } catch (error) {
    log.warn('legacy-port: conversations: failed to parse legacy pty-session-map.json', {
      mapPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return targets;
  }

  if (!isPlainRecord(rawJson)) return targets;

  for (const [ptyKey, rawEntry] of Object.entries(rawJson)) {
    if (!isPlainRecord(rawEntry)) continue;

    const entry = rawEntry as LegacyPtySessionMapEntry;
    const target =
      toTrimmedString(entry.uuid) ??
      toTrimmedString(entry.resumeTarget) ??
      toTrimmedString((rawEntry as Record<string, unknown>).target);

    if (!target || !isValidResumeUuid(target)) continue;

    if (ptyKey.startsWith(LEGACY_CLAUDE_CHAT_PREFIX)) {
      const legacyConversationId = toTrimmedString(ptyKey.slice(LEGACY_CLAUDE_CHAT_PREFIX.length));
      if (legacyConversationId && !targets.chatConversationIdToUuid.has(legacyConversationId)) {
        targets.chatConversationIdToUuid.set(legacyConversationId, target);
      }
      continue;
    }

    if (ptyKey.startsWith(LEGACY_CLAUDE_MAIN_PREFIX)) {
      const legacyTaskId = toTrimmedString(ptyKey.slice(LEGACY_CLAUDE_MAIN_PREFIX.length));
      if (legacyTaskId && !targets.mainTaskIdToUuid.has(legacyTaskId)) {
        targets.mainTaskIdToUuid.set(legacyTaskId, target);

        if (legacyTaskId.startsWith(LEGACY_OPTIMISTIC_TASK_PREFIX)) {
          const optimisticTimestampPart = toTrimmedString(
            legacyTaskId.slice(LEGACY_OPTIMISTIC_TASK_PREFIX.length)
          );
          const optimisticTimestampMs = Number.parseInt(optimisticTimestampPart ?? '', 10);
          if (Number.isFinite(optimisticTimestampMs)) {
            targets.optimisticMainByTimestamp.push({
              timestampMs: optimisticTimestampMs,
              resumeUuid: target,
            });
          }
        }
      }
    }
  }

  targets.optimisticMainByTimestamp.sort((a, b) => a.timestampMs - b.timestampMs);

  return targets;
}

function parseConversationTimestampMs(conversationId: string): number | undefined {
  const match = conversationId.match(CONVERSATION_ID_TIMESTAMP_PATTERN);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseTaskIdFromConversationId(conversationId: string): string | undefined {
  if (!conversationId.startsWith('conv-')) return undefined;
  const timestampMatch = conversationId.match(CONVERSATION_ID_TIMESTAMP_PATTERN);
  if (!timestampMatch) return undefined;

  const prefixLength = 'conv-'.length;
  const timestampStart = conversationId.length - timestampMatch[0].length;
  if (timestampStart <= prefixLength) return undefined;

  return toTrimmedString(conversationId.slice(prefixLength, timestampStart));
}

function findOptimisticMainResumeUuidForConversation(
  conversationId: string,
  targets: LegacyClaudeResumeTargets
): string | undefined {
  const conversationTimestampMs = parseConversationTimestampMs(conversationId);
  if (!conversationTimestampMs || targets.optimisticMainByTimestamp.length === 0) {
    return undefined;
  }

  let bestMatch: { distanceMs: number; resumeUuid: string } | undefined;
  let secondBestDistanceMs: number | undefined;

  for (const candidate of targets.optimisticMainByTimestamp) {
    const distanceMs = Math.abs(candidate.timestampMs - conversationTimestampMs);
    if (distanceMs > MAX_OPTIMISTIC_MAIN_TIMESTAMP_DRIFT_MS) continue;

    if (!bestMatch || distanceMs < bestMatch.distanceMs) {
      secondBestDistanceMs = bestMatch?.distanceMs;
      bestMatch = { distanceMs, resumeUuid: candidate.resumeUuid };
      continue;
    }

    if (secondBestDistanceMs === undefined || distanceMs < secondBestDistanceMs) {
      secondBestDistanceMs = distanceMs;
    }
  }

  if (!bestMatch) return undefined;

  if (secondBestDistanceMs !== undefined && secondBestDistanceMs === bestMatch.distanceMs) {
    return undefined;
  }

  return bestMatch.resumeUuid;
}

function pickConversationIdForInsert(params: {
  legacyConversationId: string;
  legacyTaskId: string;
  legacyProvider: string | null;
  conversationIds: Set<string>;
  claudeResumeTargets: LegacyClaudeResumeTargets;
}): string {
  const {
    legacyConversationId,
    legacyTaskId,
    legacyProvider,
    conversationIds,
    claudeResumeTargets,
  } = params;

  if (legacyProvider?.toLowerCase() !== 'claude') {
    return legacyConversationId;
  }

  const candidateResumeUuid =
    claudeResumeTargets.chatConversationIdToUuid.get(legacyConversationId) ??
    claudeResumeTargets.mainTaskIdToUuid.get(legacyTaskId) ??
    (() => {
      const taskIdFromConversationId = parseTaskIdFromConversationId(legacyConversationId);
      return taskIdFromConversationId
        ? claudeResumeTargets.mainTaskIdToUuid.get(taskIdFromConversationId)
        : undefined;
    })() ??
    findOptimisticMainResumeUuidForConversation(legacyConversationId, claudeResumeTargets);

  if (!candidateResumeUuid || !isValidResumeUuid(candidateResumeUuid)) {
    return legacyConversationId;
  }

  if (conversationIds.has(candidateResumeUuid)) {
    log.warn('legacy-port: conversations: claude resume uuid collides, falling back to legacy id', {
      legacyConversationId,
      legacyTaskId,
      candidateResumeUuid,
    });
    return legacyConversationId;
  }

  return candidateResumeUuid;
}

export async function portConversations({
  appDb,
  legacyDb,
  remap,
  mergedLegacyTaskIds,
  userDataPath,
}: PortContext & {
  mergedLegacyTaskIds: Set<string>;
  userDataPath?: string;
}): Promise<PortSummary> {
  const summary = createPortSummary('conversations');
  const nowIso = new Date().toISOString();
  const claudeResumeTargets = readLegacyClaudeResumeTargets(userDataPath);

  const taskRows = await appDb
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
    })
    .from(tasks)
    .execute();

  const taskIdToProjectId = new Map<string, string>();
  for (const row of taskRows) {
    taskIdToProjectId.set(row.id, row.projectId);
  }

  const existingConversationRows = await appDb
    .select({ id: conversations.id })
    .from(conversations)
    .execute();
  const conversationIds = new Set<string>(existingConversationRows.map((row) => row.id));

  const legacyRows = readLegacyRows(legacyDb, 'conversations', [
    'id',
    'task_id',
    'title',
    'provider',
    'created_at',
    'updated_at',
  ]);

  for (const row of legacyRows) {
    summary.considered += 1;

    const legacyTaskId = toTrimmedString(row.task_id);
    const legacyConversationId = toTrimmedString(row.id);

    if (!legacyTaskId || !legacyConversationId) {
      summary.skippedInvalid += 1;
      continue;
    }

    if (mergedLegacyTaskIds.has(legacyTaskId)) {
      summary.skippedDedup += 1;
      continue;
    }

    const mappedTaskId = remap.taskId.get(legacyTaskId);
    if (!mappedTaskId) {
      summary.skippedError += 1;
      continue;
    }

    const mappedProjectId = taskIdToProjectId.get(mappedTaskId);
    if (!mappedProjectId) {
      summary.skippedError += 1;
      continue;
    }

    const legacyProvider = toTrimmedString(row.provider) ?? null;
    const preferredConversationId = pickConversationIdForInsert({
      legacyConversationId,
      legacyTaskId,
      legacyProvider,
      conversationIds,
      claudeResumeTargets,
    });

    let nextConversationId = conversationIds.has(preferredConversationId)
      ? randomUUID()
      : preferredConversationId;

    const insertValues = {
      id: nextConversationId,
      projectId: mappedProjectId,
      taskId: mappedTaskId,
      title:
        toTrimmedString(row.title) ?? `Legacy conversation ${legacyConversationId.slice(0, 8)}`,
      provider: legacyProvider,
      config: null,
      createdAt: toIsoTimestamp(row.created_at, nowIso),
      updatedAt: toIsoTimestamp(row.updated_at, nowIso),
    };

    let inserted = false;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        insertValues.id = nextConversationId;
        await appDb.insert(conversations).values(insertValues).execute();
        inserted = true;
        break;
      } catch (error) {
        if (attempt === 0 && isUniqueConstraintError(error, 'conversations.id')) {
          nextConversationId = randomUUID();
          continue;
        }

        summary.skippedError += 1;
        log.warn('legacy-port: conversations: failed to insert row', {
          legacyConversationId,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }

    if (!inserted) continue;

    conversationIds.add(nextConversationId);
    summary.inserted += 1;
  }

  return summary;
}
