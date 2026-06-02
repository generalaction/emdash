import crypto from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { projectManager } from '@main/core/projects/project-manager';
import { providerRepositoryService } from '@main/core/repository/provider-repository-service';
import { db } from '@main/db/client';
import { conversations, tasks, workspaces } from '@main/db/schema';
import { events } from '@main/lib/events';
import { type ConversationConfig, serializeConversationConfig } from '@shared/conversation-config';
import type { Conversation } from '@shared/conversations';
import { conversationCreatedChannel } from '@shared/events/conversationEvents';
import { err, ok, type Result } from '@shared/result';
import type {
  CreateTaskError,
  CreateTaskParams,
  CreateTaskSuccess,
  TaskLifecycleStatus,
} from '@shared/tasks';
import { serializeWorkspaceConfig } from '@shared/workspace-config';
import { prQueryService } from '../../pull-requests/pr-query-service';
import { mapTaskRowToTask } from '../utils/utils';

export async function createTask(
  params: CreateTaskParams
): Promise<Result<CreateTaskSuccess, CreateTaskError>> {
  if (!projectManager.getProject(params.projectId)) {
    return err({ type: 'project-not-found' });
  }

  const { workspaceConfig } = params;
  const initialStatus: TaskLifecycleStatus = params.initialStatus ?? 'in_progress';

  const [taskRow] = await db
    .insert(tasks)
    .values({
      id: params.id,
      projectId: params.projectId,
      name: params.name,
      status: initialStatus,
      linkedIssue: params.linkedIssue ? JSON.stringify(params.linkedIssue) : null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      statusChangedAt: sql`CURRENT_TIMESTAMP`,
      lastInteractedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  let prs: Awaited<ReturnType<typeof prQueryService.getTaskPullRequests>> = [];
  if (workspaceConfig.git.kind === 'pr-branch') {
    const capability = await providerRepositoryService.resolveProject(params.projectId);
    if (capability.success) {
      prs = await prQueryService.getTaskPullRequests(
        params.projectId,
        workspaceConfig.git.headBranch,
        capability.data.repositoryUrl
      );
    }
  }

  const task = { ...mapTaskRowToTask(taskRow, prs), automationId: params.automationId };

  const workspaceType = ((): 'local' | 'project-ssh' | 'byoi' => {
    if (workspaceConfig.workspace.host === 'byoi') return 'byoi';
    if (workspaceConfig.workspace.host === 'project-ssh') return 'project-ssh';
    return 'local';
  })();
  const workspaceId = crypto.randomUUID();
  await db.insert(workspaces).values({
    id: workspaceId,
    type: workspaceType,
    config: serializeWorkspaceConfig(workspaceConfig),
  });
  await db.update(tasks).set({ workspaceId }).where(eq(tasks.id, params.id));

  let initialConversation: Conversation | undefined;
  if (params.initialConversation) {
    const ic = params.initialConversation;
    const configObj: ConversationConfig = {};
    if (ic.autoApprove !== undefined) configObj.autoApprove = ic.autoApprove;
    if (ic.initialPrompt?.trim()) configObj.initialPrompt = ic.initialPrompt.trim();
    const config =
      Object.keys(configObj).length > 0 ? serializeConversationConfig(configObj) : undefined;

    const [convRow] = await db
      .insert(conversations)
      .values({
        id: ic.id,
        projectId: ic.projectId,
        taskId: ic.taskId,
        title: ic.title,
        provider: ic.provider,
        config,
        isInitialConversation: true,
        createdAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
        lastInteractedAt: new Date().toISOString(),
      })
      .returning();

    initialConversation = mapConversationRowToConversation(convRow);
    events.emit(conversationCreatedChannel, { conversation: initialConversation });
  }

  return ok({ task: { ...task, workspaceId }, initialConversation });
}
