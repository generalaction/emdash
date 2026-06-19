import type { IExecutionContext } from '@main/core/execution-context/types';
import { getProjectSessionLeafIds } from '@main/core/tasks/session-targets';
import { log } from '@main/lib/logger';
import { parsePtySessionId } from '@shared/core/pty/ptySessionId';
import { LIFECYCLE_SCRIPT_TERMINAL_ID_PREFIX } from '@shared/core/terminals/terminals';
import { killTmuxSessionTree, listEmdashTmuxSessions } from './tmux-reaper';
import { decodeTmuxSessionName } from './tmux-session-name';

/**
 * Reap orphaned emdash tmux sessions for `projectId` on the context's host.
 *
 * A session is reaped only when its leaf entity (conversation or terminal) no
 * longer exists in the DB. To stay safe on a tmux server shared by several
 * projects / hosts, only sessions whose encoded `projectId` matches are even
 * considered, and workspace lifecycle-script sessions (not DB-tracked) are
 * always preserved. Detached-but-still-tracked sessions are kept, so
 * preserve-on-close resumability (PR #2281) is unaffected.
 *
 * Imports the DB (via getProjectSessionLeafIds), so keep it out of any module
 * loaded by the SSH providers — see the note in ./tmux-reaper.
 */
export async function reconcileProjectTmuxSessions(
  ctx: IExecutionContext,
  projectId: string
): Promise<void> {
  const sessionNames = await listEmdashTmuxSessions(ctx);
  if (sessionNames.length === 0) return;

  // Resolve this project's reapable sessions BEFORE touching the DB: only
  // sessions that decode to this projectId, excluding lifecycle-script terminals
  // (which create tmux sessions but have no DB row). On a tmux server shared by
  // several projects this avoids a DB round-trip on every project mount when
  // nothing on the host belongs to the project being opened.
  const candidates: Array<{ name: string; leafId: string }> = [];
  for (const name of sessionNames) {
    const sessionId = decodeTmuxSessionName(name);
    if (!sessionId) continue;
    const parsed = parsePtySessionId(sessionId);
    if (!parsed || parsed.projectId !== projectId) continue;
    if (parsed.leafId.startsWith(LIFECYCLE_SCRIPT_TERMINAL_ID_PREFIX)) continue;
    candidates.push({ name, leafId: parsed.leafId });
  }
  if (candidates.length === 0) return;

  const { conversationIds, terminalIds } = await getProjectSessionLeafIds(projectId);
  const wantedLeafIds = new Set([...conversationIds, ...terminalIds]);

  const orphans = candidates
    .filter(({ leafId }) => !wantedLeafIds.has(leafId))
    .map(({ name }) => name);

  if (orphans.length === 0) return;

  log.info('reconcileProjectTmuxSessions: reaping orphaned tmux sessions', {
    projectId,
    count: orphans.length,
  });
  await Promise.all(orphans.map((name) => killTmuxSessionTree(ctx, name)));
}
