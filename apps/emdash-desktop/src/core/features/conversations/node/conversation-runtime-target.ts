import { LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import { and, eq } from 'drizzle-orm';
import { conversationRegistryTable as conversations } from '@core/features/conversations/api/node/registry';
import type { AppDb } from '@core/services/app-db/node/db';
import { tasks } from '@core/services/app-db/node/schema';
import type { ConversationsAcpStartInput } from '../api/runtime-adapter';

/**
 * Everything a caller needs to reach a conversation's session on its host: which
 * runtime owns it, and for ACP the full start input.
 */
export type ConversationRuntimeTarget = Readonly<{
  conversationId: string;
  projectId: string;
  taskId: string;
  conversationType: 'pty' | 'acp';
  providerId: string | null;
  sessionId: string | null;
  model: string | null;
  modeId: string | null;
  effort: string | null;
  collaborationMode: string | null;
  workspacePath?: string;
  host: HostRef;
  acpInput?: ConversationsAcpStartInput;
}>;

export type WorkspaceIdentityResolver = Readonly<{
  resolve(workspaceId: string): Promise<{ host: HostRef; path: string } | null>;
}>;

export async function resolveConversationRuntimeTarget(
  conversationId: string,
  workspaceIdentity: WorkspaceIdentityResolver,
  db: AppDb,
  getProviderEnv?: (providerId: string) => Promise<Record<string, string> | undefined>
): Promise<ConversationRuntimeTarget> {
  const [row] = await db
    .select({
      projectId: conversations.projectId,
      taskId: conversations.taskId,
      providerId: conversations.provider,
      sessionId: conversations.providerSessionId,
      config: conversations.config,
      type: conversations.type,
      workspaceId: tasks.workspaceId,
    })
    .from(conversations)
    .leftJoin(
      tasks,
      and(eq(tasks.id, conversations.taskId), eq(tasks.projectId, conversations.projectId))
    )
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!row) throw new Error(`Conversation '${conversationId}' was not found`);
  if (row.projectId === null || row.taskId === null) {
    // Sessions run inside task surfaces; unlinked mirror rows have no runtime target.
    throw new Error(`Conversation '${conversationId}' has no task link`);
  }

  const identity = row.workspaceId ? await workspaceIdentity.resolve(row.workspaceId) : null;
  const acpConfig = row.config?.type === 'acp' ? row.config : undefined;
  const initialQueue =
    row.sessionId === null
      ? acpConfig?.initialQueue?.length
        ? acpConfig.initialQueue
        : acpConfig?.initialPrompt?.trim()
          ? [{ text: acpConfig.initialPrompt }]
          : undefined
      : undefined;
  const workspacePath = identity?.path;
  // Provider process env originates solely from trusted main-process settings.
  // The renderer only supplies a conversation id and cannot inject spawn variables.
  const providerEnv =
    row.providerId && getProviderEnv ? await getProviderEnv(row.providerId) : undefined;
  const acpInput =
    row.type === 'acp' && workspacePath && row.providerId
      ? {
          conversationId,
          providerId: row.providerId,
          cwd: workspacePath,
          sessionId: row.sessionId,
          model: acpConfig?.model ?? null,
          modeId: acpConfig?.modeId ?? null,
          effort: acpConfig?.effort ?? null,
          collaborationMode: acpConfig?.collaborationMode ?? null,
          ...(initialQueue && { initialQueue }),
          ...(providerEnv && { env: providerEnv }),
        }
      : undefined;

  return {
    conversationId,
    projectId: row.projectId,
    taskId: row.taskId,
    conversationType: row.type === 'acp' ? 'acp' : 'pty',
    providerId: row.providerId,
    sessionId: row.sessionId,
    model: acpConfig?.model ?? null,
    modeId: acpConfig?.modeId ?? null,
    effort: acpConfig?.effort ?? null,
    collaborationMode: acpConfig?.collaborationMode ?? null,
    workspacePath,
    host: identity?.host ?? LOCAL_HOST_REF,
    acpInput,
  };
}
