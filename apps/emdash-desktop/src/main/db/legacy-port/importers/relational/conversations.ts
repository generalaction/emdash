import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeLegacyTmuxSessionName } from '@emdash/core/services/pty/api';
import { eq } from 'drizzle-orm';
import { createConversationRegistry } from '@core/features/conversations/api/node/registry';
import type { CommandRunner } from '@core/primitives/command-runner/api/command-runner';
import { makePtySessionId } from '@core/primitives/pty/api';
import { conversations, tasks, workspaces } from '@core/services/app-db/node/schema';
import { log } from '@main/lib/logger';
import { readLegacyRows, toIsoTimestamp, toTrimmedString } from './helpers';
import { insertWithRegeneratedId } from './insert';
import { createPortSummary, type PortContext, type PortSummary } from './types';

const LEGACY_PTY_SESSION_MAP_FILE = 'pty-session-map.json';
const LEGACY_CLAUDE_CHAT_PREFIX = 'claude-chat-';
const LEGACY_CLAUDE_MAIN_PREFIX = 'claude-main-';
const LEGACY_CHAT_SEPARATOR = '-chat-';
const LEGACY_MAIN_SEPARATOR = '-main-';
const LEGACY_OPTIMISTIC_TASK_PREFIX = 'optimistic-';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONVERSATION_ID_TIMESTAMP_PATTERN = /-(\d{10,})$/;
const MAX_OPTIMISTIC_MAIN_TIMESTAMP_DRIFT_MS = 5_000;

type LegacyPtySessionMapEntry = {
  uuid?: unknown;
  resumeTarget?: unknown;
};

type LegacyPtySessionTargets = {
  chatConversationIdToUuid: Map<string, string>;
  mainTaskIdToUuid: Map<string, string>;
  optimisticMainByTimestamp: Array<{ timestampMs: number; resumeUuid: string }>;
  chatPtyIdByProviderAndConversationId: Map<string, string>;
  mainPtyIdByProviderAndTaskId: Map<string, string>;
  optimisticMainPtyByProviderAndTimestamp: Array<{
    providerId: string;
    timestampMs: number;
    legacyPtyId: string;
  }>;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidResumeUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function readLegacyPtySessionTargets(userDataPath?: string): LegacyPtySessionTargets {
  const targets: LegacyPtySessionTargets = {
    chatConversationIdToUuid: new Map<string, string>(),
    mainTaskIdToUuid: new Map<string, string>(),
    optimisticMainByTimestamp: [],
    chatPtyIdByProviderAndConversationId: new Map<string, string>(),
    mainPtyIdByProviderAndTaskId: new Map<string, string>(),
    optimisticMainPtyByProviderAndTimestamp: [],
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
    const parsedPtyKey = parseLegacyPtyKey(ptyKey);
    if (parsedPtyKey) {
      const providerId = parsedPtyKey.providerId.toLowerCase();
      const lookupKey = legacyPtyLookupKey(providerId, parsedPtyKey.suffix);

      if (parsedPtyKey.kind === 'chat') {
        if (!targets.chatPtyIdByProviderAndConversationId.has(lookupKey)) {
          targets.chatPtyIdByProviderAndConversationId.set(lookupKey, ptyKey);
        }
      } else {
        if (!targets.mainPtyIdByProviderAndTaskId.has(lookupKey)) {
          targets.mainPtyIdByProviderAndTaskId.set(lookupKey, ptyKey);
        }

        if (parsedPtyKey.suffix.startsWith(LEGACY_OPTIMISTIC_TASK_PREFIX)) {
          const optimisticTimestampPart = toTrimmedString(
            parsedPtyKey.suffix.slice(LEGACY_OPTIMISTIC_TASK_PREFIX.length)
          );
          const optimisticTimestampMs = Number.parseInt(optimisticTimestampPart ?? '', 10);
          if (Number.isFinite(optimisticTimestampMs)) {
            targets.optimisticMainPtyByProviderAndTimestamp.push({
              providerId,
              timestampMs: optimisticTimestampMs,
              legacyPtyId: ptyKey,
            });
          }
        }
      }
    }

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
  targets.optimisticMainPtyByProviderAndTimestamp.sort((a, b) => a.timestampMs - b.timestampMs);

  return targets;
}

function parseLegacyPtyKey(
  ptyKey: string
): { providerId: string; kind: 'main' | 'chat'; suffix: string } | undefined {
  const chatIndex = ptyKey.indexOf(LEGACY_CHAT_SEPARATOR);
  if (chatIndex > 0) {
    const suffix = toTrimmedString(ptyKey.slice(chatIndex + LEGACY_CHAT_SEPARATOR.length));
    if (!suffix) return undefined;
    return {
      providerId: ptyKey.slice(0, chatIndex),
      kind: 'chat',
      suffix,
    };
  }

  const mainIndex = ptyKey.indexOf(LEGACY_MAIN_SEPARATOR);
  if (mainIndex > 0) {
    const suffix = toTrimmedString(ptyKey.slice(mainIndex + LEGACY_MAIN_SEPARATOR.length));
    if (!suffix) return undefined;
    return {
      providerId: ptyKey.slice(0, mainIndex),
      kind: 'main',
      suffix,
    };
  }

  return undefined;
}

function legacyPtyLookupKey(providerId: string, suffix: string): string {
  return `${providerId}:${suffix}`;
}

function makeV0TmuxSessionName(legacyPtyId: string): string {
  return `emdash-${legacyPtyId.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
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
  targets: LegacyPtySessionTargets
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

function findOptimisticMainPtyIdForConversation(
  conversationId: string,
  providerId: string,
  targets: LegacyPtySessionTargets
): string | undefined {
  const conversationTimestampMs = parseConversationTimestampMs(conversationId);
  if (!conversationTimestampMs || targets.optimisticMainPtyByProviderAndTimestamp.length === 0) {
    return undefined;
  }

  let bestMatch: { distanceMs: number; legacyPtyId: string } | undefined;
  let secondBestDistanceMs: number | undefined;

  for (const candidate of targets.optimisticMainPtyByProviderAndTimestamp) {
    if (candidate.providerId !== providerId) continue;

    const distanceMs = Math.abs(candidate.timestampMs - conversationTimestampMs);
    if (distanceMs > MAX_OPTIMISTIC_MAIN_TIMESTAMP_DRIFT_MS) continue;

    if (!bestMatch || distanceMs < bestMatch.distanceMs) {
      secondBestDistanceMs = bestMatch?.distanceMs;
      bestMatch = { distanceMs, legacyPtyId: candidate.legacyPtyId };
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

  return bestMatch.legacyPtyId;
}

function pickLegacyPtyIdForConversation(params: {
  legacyConversationId: string;
  legacyTaskId: string;
  legacyProvider: string | null;
  legacyPtySessionTargets: LegacyPtySessionTargets;
}): string | undefined {
  const { legacyConversationId, legacyTaskId, legacyProvider, legacyPtySessionTargets } = params;
  const providerId = legacyProvider?.toLowerCase();
  if (!providerId) return undefined;

  return (
    legacyPtySessionTargets.chatPtyIdByProviderAndConversationId.get(
      legacyPtyLookupKey(providerId, legacyConversationId)
    ) ??
    legacyPtySessionTargets.mainPtyIdByProviderAndTaskId.get(
      legacyPtyLookupKey(providerId, legacyTaskId)
    ) ??
    (() => {
      const taskIdFromConversationId = parseTaskIdFromConversationId(legacyConversationId);
      return taskIdFromConversationId
        ? legacyPtySessionTargets.mainPtyIdByProviderAndTaskId.get(
            legacyPtyLookupKey(providerId, taskIdFromConversationId)
          )
        : undefined;
    })() ??
    findOptimisticMainPtyIdForConversation(
      legacyConversationId,
      providerId,
      legacyPtySessionTargets
    )
  );
}

export type LegacyTmuxSessionRename = {
  legacyPtyId: string;
  oldName: string;
  newName: string;
};

export type ConversationPortResult = {
  summary: PortSummary;
  /** Renames for imported conversations; apply with `renameLegacyTmuxSessions` after commit. */
  tmuxSessionRenames: LegacyTmuxSessionRename[];
};

/** Renames live v0 tmux sessions to the names their imported v1 conversations look up. */
export async function renameLegacyTmuxSessions(
  renames: readonly LegacyTmuxSessionRename[],
  tmuxExec: CommandRunner
): Promise<void> {
  for (const { legacyPtyId, oldName, newName } of renames) {
    try {
      await tmuxExec('tmux', ['has-session', '-t', `=${oldName}`]);
    } catch {
      continue;
    }

    try {
      await tmuxExec('tmux', ['has-session', '-t', `=${newName}`]);
      continue;
    } catch {
      // Expected when the v1 session name has not been created yet.
    }

    try {
      await tmuxExec('tmux', ['rename-session', '-t', `=${oldName}`, newName]);
    } catch (error) {
      log.debug('legacy-port: conversations: failed to rename legacy tmux session', {
        legacyPtyId,
        oldName,
        newName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function legacyClaudeResumeId(params: {
  legacyConversationId: string;
  legacyTaskId: string;
  legacyProvider: string | null;
  legacyPtySessionTargets: LegacyPtySessionTargets;
}): string | undefined {
  const { legacyConversationId, legacyTaskId, legacyProvider, legacyPtySessionTargets } = params;
  if (legacyProvider?.toLowerCase() !== 'claude') return undefined;
  return (
    legacyPtySessionTargets.chatConversationIdToUuid.get(legacyConversationId) ??
    legacyPtySessionTargets.mainTaskIdToUuid.get(legacyTaskId) ??
    (() => {
      const taskId = parseTaskIdFromConversationId(legacyConversationId);
      return taskId ? legacyPtySessionTargets.mainTaskIdToUuid.get(taskId) : undefined;
    })() ??
    findOptimisticMainResumeUuidForConversation(legacyConversationId, legacyPtySessionTargets)
  );
}

function pickClaudeResumeIdForInsert(params: {
  legacyConversationId: string;
  legacyTaskId: string;
  legacyProvider: string | null;
  conversationIds: Set<string>;
  legacyPtySessionTargets: LegacyPtySessionTargets;
}): string | null {
  const {
    legacyConversationId,
    legacyTaskId,
    legacyProvider,
    conversationIds,
    legacyPtySessionTargets,
  } = params;

  if (legacyProvider?.toLowerCase() !== 'claude') {
    return null;
  }

  const candidateResumeUuid = legacyClaudeResumeId({
    legacyConversationId,
    legacyTaskId,
    legacyProvider,
    legacyPtySessionTargets,
  });

  if (!candidateResumeUuid || !isValidResumeUuid(candidateResumeUuid)) {
    return null;
  }

  if (conversationIds.has(candidateResumeUuid)) {
    log.warn('legacy-port: conversations: claude resume uuid collides, falling back to legacy id', {
      legacyConversationId,
      legacyTaskId,
      candidateResumeUuid,
    });
    return null;
  }

  return candidateResumeUuid;
}

export function portConversations({
  appDb,
  legacyDb,
  remap,
  mergedLegacyTaskIds,
  userDataPath,
}: PortContext & {
  mergedLegacyTaskIds: Set<string>;
  userDataPath?: string;
}): ConversationPortResult {
  const summary = createPortSummary('conversations');
  const tmuxSessionRenames: LegacyTmuxSessionRename[] = [];
  const nowIso = new Date().toISOString();
  const legacyPtySessionTargets = readLegacyPtySessionTargets(userDataPath);
  const registry = createConversationRegistry(appDb);

  const taskRows = appDb
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      path: workspaces.path,
      location: workspaces.location,
      sshConnectionId: workspaces.sshConnectionId,
    })
    .from(tasks)
    .leftJoin(workspaces, eq(tasks.workspaceId, workspaces.id))
    .all();

  const taskIdToProjectId = new Map<string, string>();
  const taskWorkspaces = new Map(taskRows.map((row) => [row.id, row]));
  for (const row of taskRows) {
    taskIdToProjectId.set(row.id, row.projectId);
  }

  const existingConversationRows = appDb.select({ id: conversations.id }).from(conversations).all();
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
    const providerSessionId = pickClaudeResumeIdForInsert({
      legacyConversationId,
      legacyTaskId,
      legacyProvider,
      conversationIds,
      legacyPtySessionTargets,
    });
    const preferredConversationId = providerSessionId ?? legacyConversationId;
    const legacyPtyId = pickLegacyPtyIdForConversation({
      legacyConversationId,
      legacyTaskId,
      legacyProvider,
      legacyPtySessionTargets,
    });

    const workspace = taskWorkspaces.get(mappedTaskId);
    const insertValues = {
      id: preferredConversationId,
      projectId: mappedProjectId,
      taskId: mappedTaskId,
      title:
        toTrimmedString(row.title) ?? `Legacy conversation ${legacyConversationId.slice(0, 8)}`,
      provider: legacyProvider,
      type: 'pty' as const,
      config: null,
      idRegime: 'emdash-chosen' as const,
      cwd: workspace?.path ?? null,
      workspacePath: workspace?.path ?? null,
      providerSessionId,
      location: workspace?.location ?? 'local',
      sshConnectionId: workspace?.sshConnectionId ?? null,
      createdAt: toIsoTimestamp(row.created_at, nowIso),
      updatedAt: toIsoTimestamp(row.updated_at, nowIso),
    };

    const insertResult = insertWithRegeneratedId({
      initialId: preferredConversationId,
      existingIds: conversationIds,
      uniqueConstraintDetail: 'conversations.id',
      setId: (id) => {
        insertValues.id = id;
        if (id !== preferredConversationId) insertValues.providerSessionId = null;
      },
      insert: () => registry.register(insertValues),
    });

    if (!insertResult.inserted) {
      summary.skippedError += 1;
      log.warn('legacy-port: conversations: failed to insert row', {
        legacyConversationId,
        error:
          insertResult.error instanceof Error
            ? insertResult.error.message
            : String(insertResult.error),
      });
      continue;
    }

    if (legacyPtyId) {
      const oldName = makeV0TmuxSessionName(legacyPtyId);
      const newName = makeLegacyTmuxSessionName(
        makePtySessionId(mappedProjectId, mappedTaskId, insertResult.id)
      );
      if (oldName !== newName) tmuxSessionRenames.push({ legacyPtyId, oldName, newName });
    }

    conversationIds.add(insertResult.id);
    summary.inserted += 1;
  }

  return { summary, tmuxSessionRenames };
}
