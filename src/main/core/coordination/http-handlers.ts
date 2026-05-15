import type http from 'node:http';
import { eq } from 'drizzle-orm';
import { parsePtyId } from '@shared/ptyId';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { activityStore } from './activity-store';

/**
 * Lookup taskId + projectId from the `X-Emdash-Pty-Id` header that every
 * spawned agent already has in its environment. Same pattern as the existing
 * `event-enricher.ts:enrichEvent`.
 */
function resolveCaller(ptyId: string): { taskId: string; projectId: string } | null {
  const parsed = parsePtyId(ptyId);
  if (!parsed) return null;
  const rows = db
    .select({ taskId: conversations.taskId, projectId: conversations.projectId })
    .from(conversations)
    .where(eq(conversations.id, parsed.conversationId))
    .limit(1)
    .all();
  const row = rows[0];
  if (!row) return null;
  return { taskId: row.taskId, projectId: row.projectId };
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload).toString(),
  });
  res.end(payload);
}

function ptyIdFromHeaders(req: http.IncomingMessage): string {
  return String(req.headers['x-emdash-pty-id'] || '');
}

/**
 * GET /coord/siblings
 *
 * Returns the calling task's sibling activity (other active/idle tasks in
 * the same project, with their touched files).
 */
export function handleSiblings(req: http.IncomingMessage, res: http.ServerResponse): void {
  const ptyId = ptyIdFromHeaders(req);
  if (!ptyId) {
    writeJson(res, 400, { error: 'missing X-Emdash-Pty-Id header' });
    return;
  }
  const caller = resolveCaller(ptyId);
  if (!caller) {
    writeJson(res, 404, { error: 'unrecognised pty id' });
    return;
  }
  try {
    const siblings = activityStore.listSiblings(caller.projectId, caller.taskId);
    writeJson(res, 200, { siblings });
  } catch (e) {
    log.warn('coordination: /coord/siblings failed', { error: String(e) });
    writeJson(res, 500, { error: 'internal error' });
  }
}

/**
 * GET /coord/overlap?paths=src/a.ts,src/b.ts
 *
 * Returns which sibling tasks have touched each of the given repo-relative
 * paths. Paths are deduplicated; empty input yields an empty array.
 */
export function handleOverlap(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const ptyId = ptyIdFromHeaders(req);
  if (!ptyId) {
    writeJson(res, 400, { error: 'missing X-Emdash-Pty-Id header' });
    return;
  }
  const caller = resolveCaller(ptyId);
  if (!caller) {
    writeJson(res, 404, { error: 'unrecognised pty id' });
    return;
  }
  const raw = url.searchParams.get('paths') ?? '';
  const paths = [
    ...new Set(
      raw
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
    ),
  ];
  try {
    const overlaps = activityStore.findOverlap(caller.projectId, caller.taskId, paths);
    writeJson(res, 200, { overlaps });
  } catch (e) {
    log.warn('coordination: /coord/overlap failed', { error: String(e) });
    writeJson(res, 500, { error: 'internal error' });
  }
}
