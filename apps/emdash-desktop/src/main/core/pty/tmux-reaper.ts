import type { IExecutionContext } from '@main/core/execution-context/types';
import { log } from '@main/lib/logger';
import { collectDescendantPids, parsePidPpidPairs } from './process-tree';
import { killTmuxSession, TMUX_SESSION_PREFIX } from './tmux-session-name';

// NOTE: this module must stay free of DB imports. It is loaded by the SSH
// conversation/terminal providers (for killTmuxSessionTree); pulling in the DB
// client here would break their unit tests, which run without Electron's `app`.
// DB-dependent reconciliation lives in ./tmux-reconcile.

/**
 * List the names of all `emdash-*` tmux sessions on the context's host.
 * Returns `[]` when no tmux server is running (tmux exits non-zero), tmux is
 * absent, or the command otherwise fails — callers treat that as "nothing to do".
 */
export async function listEmdashTmuxSessions(ctx: IExecutionContext): Promise<string[]> {
  try {
    const { stdout } = await ctx.exec('tmux', ['list-sessions', '-F', '#{session_name}']);
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((name) => name.startsWith(TMUX_SESSION_PREFIX));
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
