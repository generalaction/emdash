import { type Result, ok } from '@emdash/shared';
import { parseAbsolute, containsAbsolute, type HostAbsolutePath } from '@primitives/path/api';
import type { HostRuntimesClient } from '@services/runtime-broker/api';
import type { WorkspaceHostError } from '../../api';

export type WorkspaceHostSessionClients = Pick<
  HostRuntimesClient,
  'acp' | 'terminals' | 'tuiAgents'
>;

export interface SessionCleanupReport {
  acpSessions: number;
  terminalSessions: number;
  tuiSessions: number;
}

export async function killSessionsUnderPath(
  clients: WorkspaceHostSessionClients,
  path: HostAbsolutePath
): Promise<Result<SessionCleanupReport, WorkspaceHostError>> {
  const targets = await resolveSessionTargets(clients, path);

  for (const conversationId of targets.acpConversationIds) {
    const result = await clients.acp.killSession({ conversationId });
    if (!result.success && !isMissingError(result.error)) {
      return sessionError(
        `Failed to kill ACP session ${conversationId}: ${errorMessage(result.error)}`
      );
    }
  }

  for (const conversationId of targets.tuiConversationIds) {
    const result = await clients.tuiAgents.deleteSession({ conversationId });
    if (!result.success && !isMissingError(result.error)) {
      return sessionError(
        `Failed to delete TUI session ${conversationId}: ${errorMessage(result.error)}`
      );
    }
  }

  for (const key of targets.terminalKeys) {
    const result = await clients.terminals.kill({ key });
    if (!result.success && !isMissingError(result.error)) {
      return sessionError(
        `Failed to kill terminal session ${key.id}: ${errorMessage(result.error)}`
      );
    }
  }

  return ok({
    acpSessions: targets.acpConversationIds.length,
    terminalSessions: targets.terminalKeys.length,
    tuiSessions: targets.tuiConversationIds.length,
  });
}

async function resolveSessionTargets(clients: WorkspaceHostSessionClients, path: HostAbsolutePath) {
  const [terminalSnapshot, acpSnapshot, tuiSnapshot] = await Promise.all([
    clients.terminals.sessions.state(undefined, 'list').snapshot(),
    clients.acp.sessions.state(undefined, 'list').snapshot(),
    clients.tuiAgents.sessions.state(undefined, 'list').snapshot(),
  ]);

  const terminalKeys = Object.values(terminalSnapshot.data)
    .filter((session) => pathContains(path, session.key.workspace.path))
    .map((session) => session.key);

  const acpConversationIds = Object.values(acpSnapshot.data)
    .filter((session) => session.cwd && pathContains(path, parsePath(session.cwd)))
    .map((session) => session.conversationId);

  const tuiConversationIds = Object.values(tuiSnapshot.data)
    .filter((session) => session.cwd && pathContains(path, parsePath(session.cwd)))
    .map((session) => session.conversationId);

  return {
    acpConversationIds,
    terminalKeys,
    tuiConversationIds,
  };
}

function pathContains(root: HostAbsolutePath, candidate: HostAbsolutePath | null): boolean {
  return candidate !== null && containsAbsolute(root, candidate);
}

function parsePath(path: string): HostAbsolutePath | null {
  const parsed = parseAbsolute(path);
  return parsed.success ? parsed.data : null;
}

function sessionError(message: string): Result<never, WorkspaceHostError> {
  return {
    success: false,
    error: { type: 'runtime-unavailable', message },
  };
}

function isMissingError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('type' in error)) return false;
  const type = String(error.type);
  return type === 'not-found' || type === 'workspace-not-found' || type === 'missing-workspace';
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}
