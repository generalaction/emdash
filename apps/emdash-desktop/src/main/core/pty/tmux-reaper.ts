import { collectDescendantPids, parsePidPpidPairs } from '@emdash/core/pty';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { log } from '@main/lib/logger';
import { makePtySessionId, parsePtySessionId } from '@shared/core/pty/ptySessionId';
import type { TmuxSessionIdentity } from '@shared/core/pty/tmux';
import {
  decodeLegacyTmuxSessionName,
  killTmuxSession,
  TMUX_LEAF_ID_OPTION,
  TMUX_PROJECT_ID_OPTION,
  TMUX_SESSION_PREFIX,
  TMUX_TASK_ID_OPTION,
} from './tmux-session-name';

// NOTE: this module must stay free of DB imports. It is loaded by the SSH
// conversation/terminal providers (for killTmuxSessionTree); pulling in the DB
// client here would break their unit tests, which run without Electron's `app`.
// DB-dependent reconciliation lives in ./tmux-reconcile.

export type EmdashTmuxSession = {
  name: string;
  identity: TmuxSessionIdentity | null;
};

const TMUX_SESSION_LIST_FORMAT = [
  '#{session_name}',
  `#{${TMUX_PROJECT_ID_OPTION}}`,
  `#{${TMUX_TASK_ID_OPTION}}`,
  `#{${TMUX_LEAF_ID_OPTION}}`,
].join('\t');

function legacyIdentity(sessionName: string): TmuxSessionIdentity | null {
  const sessionId = decodeLegacyTmuxSessionName(sessionName);
  if (!sessionId) return null;
  const parsed = parsePtySessionId(sessionId);
  if (!parsed) return null;
  return { projectId: parsed.projectId, taskId: parsed.scopeId, leafId: parsed.leafId };
}

function identityFromFields(fields: string[]): TmuxSessionIdentity | null {
  const [projectId, taskId, leafId] = fields;
  return projectId && taskId && leafId ? { projectId, taskId, leafId } : null;
}

function identityFromOptionList(stdout: string): TmuxSessionIdentity | null {
  const options = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const separator = line.indexOf(' ');
    if (separator <= 0) continue;
    options.set(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  return identityFromFields([
    options.get(TMUX_PROJECT_ID_OPTION) ?? '',
    options.get(TMUX_TASK_ID_OPTION) ?? '',
    options.get(TMUX_LEAF_ID_OPTION) ?? '',
  ]);
}

async function readIdentityFromOptions(
  ctx: IExecutionContext,
  sessionName: string
): Promise<TmuxSessionIdentity | null> {
  try {
    const { stdout } = await ctx.exec('tmux', ['show-options', '-t', sessionName]);
    return identityFromOptionList(stdout);
  } catch {
    return null;
  }
}

async function listSessionLines(ctx: IExecutionContext): Promise<string[]> {
  let formatError: unknown;
  try {
    const { stdout } = await ctx.exec('tmux', ['list-sessions', '-F', TMUX_SESSION_LIST_FORMAT]);
    const lines = stdout.split('\n').filter(Boolean);
    if (lines.length > 0) return lines;
    formatError = new Error('rich tmux session format returned an empty result');
  } catch (err) {
    formatError = err;
  }

  // Old tmux releases may reject user-option expansion in a format or return a
  // successful empty result for it. Listing names alone still lets us decode
  // legacy names and read friendly-session options with show-options below.
  try {
    const { stdout } = await ctx.exec('tmux', ['list-sessions', '-F', '#{session_name}']);
    return stdout.split('\n').filter(Boolean);
  } catch (err) {
    log.debug('listEmdashTmuxSessions: no tmux sessions', {
      error: String(err),
      formatError: String(formatError),
    });
    return [];
  }
}

/**
 * List all `emdash-*` sessions with their persisted identity. Modern tmux
 * returns every identity in one list-sessions call. Legacy encoded names are
 * decoded directly, while old tmux versions that cannot expand user options in
 * formats fall back to one show-options call for each friendly-named session.
 */
export async function listEmdashTmuxSessions(ctx: IExecutionContext): Promise<EmdashTmuxSession[]> {
  try {
    const lines = await listSessionLines(ctx);
    const sessions = lines
      .map((line): EmdashTmuxSession | null => {
        const [name, ...metadata] = line.split('\t');
        if (!name?.startsWith(TMUX_SESSION_PREFIX)) return null;
        return { name, identity: identityFromFields(metadata) ?? legacyIdentity(name) };
      })
      .filter((session): session is EmdashTmuxSession => session !== null);

    await Promise.all(
      sessions.map(async (session) => {
        if (session.identity) return;
        session.identity = await readIdentityFromOptions(ctx, session.name);
      })
    );
    return sessions;
  } catch (err) {
    log.debug('listEmdashTmuxSessions: no tmux sessions', { error: String(err) });
    return [];
  }
}

/**
 * Snapshot the transitive descendants of a tmux session's panes on the context's
 * host. Must be called BEFORE `kill-session`: once the panes die the survivors
 * are reparented to init and become unreachable.
 *
 * Returns only the descendants, NOT the pane pids themselves — `kill-session`
 * already signals the panes, so by the time we reap they are likely dead and
 * their pids may have been recycled to unrelated processes. The escaped
 * descendants (the setsid() dev servers we are after) survive `kill-session`, so
 * they are still alive and safe to target. Resolves `[]` if `ps` is unavailable.
 */
async function collectSessionDescendantPids(
  ctx: IExecutionContext,
  sessionName: string
): Promise<number[]> {
  let panePids: number[];
  try {
    const { stdout } = await ctx.exec('tmux', [
      'list-panes',
      '-s',
      '-t',
      sessionName,
      '-F',
      '#{pane_pid}',
    ]);
    panePids = stdout
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 1);
  } catch {
    return [];
  }
  if (panePids.length === 0) return [];

  try {
    const { stdout } = await ctx.exec('ps', ['-A', '-o', 'pid=,ppid=']);
    return collectDescendantPids(parsePidPpidPairs(stdout), panePids);
  } catch {
    // No process table — we cannot identify the escaped descendants. The panes
    // themselves are handled by kill-session, so there is nothing else to reap.
    return [];
  }
}

/**
 * Force-reap remote orphan pids with SIGKILL. These are setsid() escapees that
 * outlived `kill-session`'s SIGHUP; graceful shutdown is not a goal (the OS frees
 * their ports on death either way), so a SIGTERM grace would only add latency.
 * The pids are validated integers, so embedding them in the script is safe.
 */
async function reapPids(ctx: IExecutionContext, pids: number[]): Promise<void> {
  const list = pids.filter((pid) => Number.isInteger(pid) && pid > 1).join(' ');
  if (!list) return;
  const script = `kill -KILL ${list} 2>/dev/null || true`;
  try {
    await ctx.exec('sh', ['-c', script]);
  } catch (err) {
    log.debug('reapPids: remote kill failed', { error: String(err) });
  }
}

/**
 * Kill a tmux session AND its orphaned descendant processes. `tmux kill-session`
 * only sends SIGHUP to the pane processes; dev servers (vite/metro/expo,
 * watchman) double-fork / setsid and survive as port-holding orphans. We
 * snapshot the pane process trees first, kill the session, then reap the
 * surviving descendants. Best-effort and never throws. See issue #2580.
 */
export async function killTmuxSessionTree(
  ctx: IExecutionContext,
  sessionName: string
): Promise<void> {
  const descendants = await collectSessionDescendantPids(ctx, sessionName);
  await killTmuxSession(ctx, sessionName);
  if (descendants.length > 0) {
    await reapPids(ctx, descendants);
  }
}

/**
 * Kill every tmux session matching one of the PTY session ids. Resolving by
 * persisted identity keeps stop/delete behavior compatible with legacy names,
 * friendly names, and workspace label changes. A batch performs one session
 * listing on modern tmux.
 */
export async function killTmuxSessionsByPtyIds(
  ctx: IExecutionContext,
  sessionIds: Iterable<string>,
  options: { reapDescendants?: boolean } = {}
): Promise<void> {
  const wanted = new Set(sessionIds);
  if (wanted.size === 0) return;

  const sessions = await listEmdashTmuxSessions(ctx);
  const matches = sessions.filter(({ identity }) => {
    if (!identity) return false;
    return wanted.has(makePtySessionId(identity.projectId, identity.taskId, identity.leafId));
  });
  await Promise.all(
    matches.map(({ name }) =>
      options.reapDescendants ? killTmuxSessionTree(ctx, name) : killTmuxSession(ctx, name)
    )
  );
}
