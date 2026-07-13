import { err, ok, type Result } from '@emdash/shared';
import type { SessionInfo } from '@services/workspace-activity/api';
import type { CoordinatorError } from './schema';

export type ActivityLookup = {
  sessionsFor(path: string): SessionInfo[];
};

export function assertWorkspaceIdle(
  activity: ActivityLookup,
  path: string,
  force = false
): Result<void, CoordinatorError> {
  if (force) return ok(undefined);

  const holders = activity
    .sessionsFor(path)
    .map((session) => `${session.runtime}:${session.sessionId}`);
  if (holders.length === 0) return ok(undefined);

  return err({
    type: 'workspace-busy',
    message: 'Workspace has active sessions',
    holders,
    resolutions: ['force'],
  });
}
