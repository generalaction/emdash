import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { conversations, tasks, workspaces } from '@main/db/schema';
import type { ConversationRow, TaskRow } from '@main/db/schema';
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
import { mapTaskRowToTask } from '../utils/utils';

type ConvInsert = typeof conversations.$inferInsert;

export async function createTask(
  params: CreateTaskParams
): Promise<Result<CreateTaskSuccess, CreateTaskError>> {
  if (!projectManager.getProject(params.projectId)) {
    return err({ type: 'project-not-found' });
  }

  const { workspaceConfig } = params;
  const initialStatus: TaskLifecycleStatus = params.initialStatus ?? 'in_progress';

  const workspaceId = crypto.randomUUID();
  const workspaceType = ((): 'local' | 'project-ssh' | 'byoi' => {
    if (workspaceConfig.workspace.host === 'byoi') return 'byoi';
    if (workspaceConfig.workspace.host === 'project-ssh') return 'project-ssh';
    return 'local';
  })();

  // Prepare conversation insert values before the transaction (no async work needed).
  let convInsert: ConvInsert | undefined;
  if (params.initialConversation) {
    const ic = params.initialConversation;
    const configObj: ConversationConfig = {};
    if (ic.autoApprove !== undefined) configObj.autoApprove = ic.autoApprove;
    if (ic.initialPrompt?.trim()) configObj.initialPrompt = ic.initialPrompt.trim();
    const config =
      Object.keys(configObj).length > 0 ? serializeConversationConfig(configObj) : undefined;
    convInsert = {
      id: ic.id,
      projectId: ic.projectId,
      taskId: ic.taskId,
      title: ic.title,
      provider: ic.provider,
      config,
      isInitialConversation: true,
      lastInteractedAt: new Date().toISOString(),
    };
  }

  // All three inserts in a single atomic transaction.
  let taskRow!: TaskRow;
  let convRow: ConversationRow | undefined;
  db.transaction((tx) => {
    [taskRow] = tx
      .insert(tasks)
      .values({
        id: params.id,
        projectId: params.projectId,
        name: params.name,
        status: initialStatus,
        workspaceId,
        linkedIssue: params.linkedIssue ? JSON.stringify(params.linkedIssue) : null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
        statusChangedAt: sql`CURRENT_TIMESTAMP`,
        lastInteractedAt: sql`CURRENT_TIMESTAMP`,
      })
      .returning()
      .all();

    tx.insert(workspaces)
      .values({
        id: workspaceId,
        type: workspaceType,
        config: serializeWorkspaceConfig(workspaceConfig),
      })
      .run();

    if (convInsert) {
      [convRow] = tx.insert(conversations).values(convInsert).returning().all();
    }
  });

  // Post-transaction side effects.
  const task = { ...mapTaskRowToTask(taskRow, []), automationId: params.automationId };
  let initialConversation: Conversation | undefined;
  if (convRow) {
    initialConversation = mapConversationRowToConversation(convRow);
    events.emit(conversationCreatedChannel, { conversation: initialConversation });
  }

  return ok({ task: { ...task, workspaceId }, initialConversation });
}
