import { makeTmuxSessionName } from '@emdash/core/services/pty/api';
import { and, eq } from 'drizzle-orm';
import { conversationEvents } from '@core/features/conversations/api/node/conversation-events';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import { resolveTask } from '@core/features/projects/api/node/utils';
import type { TaskSessionManager } from '@core/features/tasks/api/node/task-session-manager';
import { makePtySessionId } from '@core/primitives/pty/api';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb } from '@core/services/app-db/node/db';
import { conversations } from '@core/services/app-db/node/schema';

export async function deleteConversation(
  db: AppDb,
  projects: Pick<ProjectSessionManager, 'getProject'>,
  taskSessions: Pick<TaskSessionManager, 'getTask'>,
  projectId: string,
  taskId: string,
  conversationId: string,
  telemetry: Pick<TelemetryService, 'capture'>
): Promise<void> {
  const [convRow] = await db
    .select({ type: conversations.type })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
      )
    )
    .limit(1);

  await db
    .delete(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
      )
    );

  conversationEvents._emit('conversation:deleted', conversationId);

  if (convRow?.type === 'acp') {
    telemetry.capture('conversation_deleted', {
      project_id: projectId,
      task_id: taskId,
      conversation_id: conversationId,
    });
    return;
  }

  const task = resolveTask(taskSessions, projectId, taskId);
  if (task) {
    await task.conversations.deleteSession(conversationId);
  } else {
    const project = projects.getProject(projectId);
    if (project) {
      await project.terminals.killTmuxSessions({
        sessionNames: [makeTmuxSessionName(makePtySessionId(projectId, taskId, conversationId))],
      });
    }
  }
  telemetry.capture('conversation_deleted', {
    project_id: projectId,
    task_id: taskId,
    conversation_id: conversationId,
  });
}
