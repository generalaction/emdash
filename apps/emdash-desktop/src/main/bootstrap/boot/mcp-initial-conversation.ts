import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import type { Logger } from '@emdash/shared/logger';
import { resolveConversationRuntimeTarget } from '@core/features/conversations/node/conversation-runtime-target';
import { hydrateConversation } from '@core/features/conversations/node/hydrateConversation';
import type { StartInitialConversation } from '@core/features/mcp/node/server/dependencies';
import type { TaskSessionManager } from '@core/features/tasks/api/node/task-session-manager';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb } from '@core/services/app-db/node/db';

export type StartInitialConversationDependencies = Readonly<{
  db: AppDb;
  logger: Logger;
  runtimes: RuntimeBroker;
  taskSessions: Pick<TaskSessionManager, 'getTask'>;
  telemetry: Pick<TelemetryService, 'capture'>;
  workspaceIdentity: WorkspaceIdentityService;
  getProviderEnv: (providerId: string) => Promise<Record<string, string> | undefined>;
}>;

/**
 * Starts the agent session for a freshly created task, the same two paths the
 * renderer drives when it opens a task: TUI conversations launch through the
 * host's agent session, ACP conversations attach to the host's ACP runtime.
 *
 * The caller must hold the project attachment: both paths reach the task's
 * session, which only exists while the project is attached.
 */
export function createStartInitialConversation(
  dependencies: StartInitialConversationDependencies
): StartInitialConversation {
  return async ({ projectId, taskId, conversationId, type }) => {
    try {
      if (type === 'pty') {
        await hydrateConversation(
          dependencies.db,
          dependencies.taskSessions,
          projectId,
          taskId,
          conversationId,
          dependencies.telemetry
        );
        return { started: true };
      }
      return await attachAcpSession(dependencies, conversationId);
    } catch (error) {
      dependencies.logger.warn('McpHttpServer: failed to start the initial conversation', {
        conversationId,
        taskId,
        error: String(error),
      });
      return { started: false, message: String(error) };
    }
  };
}

async function attachAcpSession(
  dependencies: StartInitialConversationDependencies,
  conversationId: string
): Promise<{ started: boolean; message?: string }> {
  const target = await resolveConversationRuntimeTarget(
    conversationId,
    dependencies.workspaceIdentity,
    dependencies.db,
    dependencies.getProviderEnv
  );
  if (!target.acpInput) {
    return { started: false, message: 'the conversation has no resolvable ACP session' };
  }
  const runtime = await dependencies.runtimes.client(target.host);
  if (!runtime.success) {
    return { started: false, message: `the task's host is unavailable (${runtime.error.type})` };
  }
  const attached = await runtime.data.acp.attach(target.acpInput);
  return attached.success
    ? { started: true }
    : { started: false, message: attached.error.message ?? attached.error.type };
}
