import type { IExecutionContext } from '#primitives/exec/api';
import { listTmuxSessions, parseTmuxSessionInventory, TmuxUnavailableError } from './tmux-commands';
import { makeLegacyTmuxSessionName, makeTmuxSessionName } from './tmux-identity';

export type ResolvedTmuxSession = {
  name: string;
  exists: boolean;
  writeIdentity: boolean;
};

export async function resolveTmuxSession(
  ctx: IExecutionContext,
  input: { identity: string; label: string }
): Promise<ResolvedTmuxSession> {
  const sessions = await listTmuxSessionsOrEmpty(ctx);
  const metadataMatch = sessions.find((session) => session.identity === input.identity);
  if (metadataMatch) {
    return { name: metadataMatch.name, exists: true, writeIdentity: true };
  }

  const legacyName = makeLegacyTmuxSessionName(input.identity);
  if (sessions.some((session) => session.name === legacyName)) {
    return { name: legacyName, exists: true, writeIdentity: false };
  }

  const name = makeTmuxSessionName(input.identity, input.label);
  const namedSession = sessions.find((session) => session.name === name);
  return { name, exists: namedSession !== undefined, writeIdentity: true };
}

export async function findTmuxSessionNamesByIdentity(
  ctx: IExecutionContext,
  identities: readonly string[]
): Promise<Map<string, string>> {
  const requested = new Set(identities);
  const found = new Map<string, string>();
  for (const session of await listTmuxSessionsOrEmpty(ctx)) {
    if (!session.identity || !requested.has(session.identity)) continue;
    if (!found.has(session.identity)) found.set(session.identity, session.name);
  }
  return found;
}

export async function listTmuxSessionActivity(
  ctx: IExecutionContext
): Promise<Map<string, number>> {
  return activityByHandle(await listTmuxSessions(ctx));
}

export function parseTmuxSessionActivity(output: string): Map<string, number> {
  return activityByHandle(parseTmuxSessionInventory(output));
}

export function tmuxIdentityActivityKey(identity: string): string {
  return `identity:${identity}`;
}

/**
 * Creation/discovery paths treat an unqueryable tmux as "nothing found": a
 * missing executable surfaces honestly when the spawned session fails, so
 * these callers need no liveness distinction. Only `listTmuxSessionActivity`
 * propagates `TmuxUnavailableError` for sweep/reconcile judgments.
 */
async function listTmuxSessionsOrEmpty(ctx: IExecutionContext) {
  try {
    return await listTmuxSessions(ctx);
  } catch (error) {
    if (error instanceof TmuxUnavailableError) return [];
    throw error;
  }
}

function activityByHandle(
  sessions: readonly { name: string; activity: number; identity: string | null }[]
): Map<string, number> {
  const activity = new Map<string, number>();
  for (const session of sessions) {
    activity.set(session.name, session.activity);
    if (session.identity) activity.set(tmuxIdentityActivityKey(session.identity), session.activity);
  }
  return activity;
}
