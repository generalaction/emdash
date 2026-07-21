import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import type { TaskSessionManager } from '@core/features/tasks/api/node/task-session-manager';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb } from '@core/services/app-db/node/db';
import type { CompensationRunner } from './createConversation';
import { createConversation } from './createConversation';
import { dehydrateConversation } from './dehydrateConversation';
import { deleteConversation } from './deleteConversation';
import { getConversations } from './getConversations';
import { getConversationsForProject } from './getConversationsForProject';
import { getConversationsForTask } from './getConversationsForTask';
import { hydrateConversation } from './hydrateConversation';
import { markConversationSeen } from './markConversationSeen';
import { renameConversation } from './renameConversation';

export function createConversationOperations(dependencies: {
  db: AppDb;
  projects: Pick<ProjectSessionManager, 'getProject'>;
  telemetry: TelemetryService;
  taskSessions: Pick<TaskSessionManager, 'getTask'>;
  withCompensation: CompensationRunner;
}) {
  const { db, telemetry, withCompensation } = dependencies;
  return {
    getConversations: () => getConversations(db),
    createConversation: (params: Parameters<typeof createConversation>[0]) =>
      createConversation(params, {
        db,
        taskSessions: dependencies.taskSessions,
        telemetry,
        withCompensation,
      }),
    deleteConversation: (projectId: string, taskId: string, conversationId: string) =>
      deleteConversation(
        db,
        dependencies.projects,
        dependencies.taskSessions,
        projectId,
        taskId,
        conversationId,
        telemetry
      ),
    hydrateConversation: (projectId: string, taskId: string, conversationId: string) =>
      hydrateConversation(
        db,
        dependencies.taskSessions,
        projectId,
        taskId,
        conversationId,
        telemetry
      ),
    dehydrateConversation: (projectId: string, taskId: string, conversationId: string) =>
      dehydrateConversation(db, dependencies.taskSessions, projectId, taskId, conversationId),
    renameConversation: (conversationId: string, name: string) =>
      renameConversation(db, conversationId, name),
    getConversationsForTask: (projectId: string, taskId: string) =>
      getConversationsForTask(db, projectId, taskId),
    getConversationsForProject: (projectId: string) => getConversationsForProject(db, projectId),
    markConversationSeen: (conversationId: string) => markConversationSeen(db, conversationId),
  };
}
