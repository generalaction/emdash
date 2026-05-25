import type { ProjectSettings } from '@shared/project-settings';
import { parsePtySessionId } from '@shared/ptySessionId';
import type { IExecutionContext } from '../execution-context/types';
import { getProjectTmuxEnabled } from '../projects/settings/tmux-enabled';
import type { TeardownMode } from '../workspaces/workspace-registry';
import { ptySessionRegistry } from './pty-session-registry';

const TMUX_AVAILABILITY_CHECK_TIMEOUT_MS = 2_000;

/** Agent sessions can survive app restarts via tmux on POSIX platforms. */
export function canPersistAgentSessions(): boolean {
  return process.platform !== 'win32';
}

export async function canUseTmuxForAgentSessions(
  ctx: Pick<IExecutionContext, 'exec' | 'supportsLocalSpawn'>
): Promise<boolean> {
  if (ctx.supportsLocalSpawn && !canPersistAgentSessions()) return false;

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<false>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve(false);
    }, TMUX_AVAILABILITY_CHECK_TIMEOUT_MS);
  });
  const checkPromise = ctx
    .exec('tmux', ['-V'], { signal: controller.signal })
    .then(() => true)
    .catch(() => false);

  try {
    return await Promise.race([checkPromise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function hasActiveAgentSessionsForProject(projectId: string): boolean {
  return ptySessionRegistry.listActiveSessions().some((session) => {
    if (!session.metadata?.providerId) return false;
    const parsed = parsePtySessionId(session.sessionId);
    return parsed?.projectId === projectId;
  });
}

export function hasActivePersistedAgentSessionsForProject(projectId: string): boolean {
  return ptySessionRegistry.listActiveSessions().some((session) => {
    if (!session.metadata?.providerId || !session.metadata.tmuxSessionName) return false;
    const parsed = parsePtySessionId(session.sessionId);
    return parsed?.projectId === projectId;
  });
}

export async function getProjectTeardownMode(
  projectId: string,
  projectSettings: ProjectSettings,
  ctx: Pick<IExecutionContext, 'exec' | 'supportsLocalSpawn'>
): Promise<TeardownMode> {
  if ((await getProjectTmuxEnabled(projectSettings)) && (await canUseTmuxForAgentSessions(ctx))) {
    return 'detach';
  }
  if (hasActivePersistedAgentSessionsForProject(projectId)) {
    return 'detach';
  }
  return 'terminate';
}
