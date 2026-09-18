import { LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import { and, eq } from 'drizzle-orm';
import { conversationRegistryTable as conversations } from '@core/features/conversations/api/node/registry';
import type { TaskSessionLaunchContextResolver } from '@core/features/tasks/api/node/task-session-launch-context';
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
  getProviderEnv: ((providerId: string) => Promise<Record<string, string> | undefined>) | undefined,
  sessionLaunchContexts: Pick<TaskSessionLaunchContextResolver, 'resolve'>
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
  // Resolve the ACP agent environment in main from provider and project/task settings. The
  // renderer supplies only a conversation id and cannot inject spawn variables.
  const [providerEnv, launchContext] = await Promise.all([
    row.providerId && getProviderEnv ? getProviderEnv(row.providerId) : undefined,
    row.type === 'acp' && workspacePath
      ? sessionLaunchContexts.resolve({
          projectId: row.projectId,
          taskId: row.taskId,
          ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
        })
      : undefined,
  ]);
  if (launchContext && !launchContext.success) {
    throw new Error(`Could not resolve task session launch context: ${launchContext.error.type}`);
  }
  const processEnv = {
    ...(providerEnv ?? {}),
    ...(launchContext?.success ? launchContext.data.env : {}),
  };
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
          ...(Object.keys(processEnv).length > 0 ? { env: processEnv } : {}),
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
