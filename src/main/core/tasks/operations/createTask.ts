import crypto from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { applyNativeChatDefaults } from '@main/core/conversations/apply-native-chat-defaults';
import { resolveConversationUiMode } from '@main/core/conversations/resolve-conversation-ui-mode';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { projectManager } from '@main/core/projects/project-manager';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { conversations, projects, tasks, workspaces } from '@main/db/schema';
import type { ConversationRow, TaskRow } from '@main/db/schema';
import { events } from '@main/lib/events';
import { type ConversationConfig, serializeConversationConfig } from '@shared/conversation-config';
import { isNativeChatProvider } from '@shared/conversation-ui';
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
  const configJson = serializeWorkspaceConfig(workspaceConfig);

  // Resolve the workspace ID and determine whether to insert a new workspace row.
  let workspaceId: string;
  let newWorkspaceValues: typeof workspaces.$inferInsert | null = null;

  const wsTarget = workspaceConfig.workspace;

  if (wsTarget.kind === 'repository-instance') {
    // Reuse the existing shared workspace for this project's repository root.
    workspaceId = wsTarget.workspaceId;
  } else {
    // Create a new workspace row for 'new-worktree' or 'byoi' targets.
    workspaceId = crypto.randomUUID();

    if (wsTarget.kind === 'byoi') {
      newWorkspaceValues = {
        id: workspaceId,
        kind: 'byoi',
        location: 'remote',
        type: 'byoi',
        config: configJson,
      };
    } else {
      // 'new-worktree' — derive location from the project.
      const [projectRow] = await db
        .select({
          workspaceProvider: projects.workspaceProvider,
          sshConnectionId: projects.sshConnectionId,
        })
        .from(projects)
        .where(eq(projects.id, params.projectId))
        .limit(1);

      const isRemote = projectRow?.workspaceProvider === 'ssh';
      const location = isRemote ? 'remote' : 'local';
      const sshConnectionId = isRemote ? (projectRow?.sshConnectionId ?? null) : null;
      const legacyType = isRemote ? 'project-ssh' : 'local';

      newWorkspaceValues = {
        id: workspaceId,
        kind: 'worktree',
        location,
        sshConnectionId,
        type: legacyType,
        config: configJson,
      };
    }
  }

  // Prepare conversation insert values before the transaction.
  let convInsert: ConvInsert | undefined;
  if (params.initialConversation) {
    const ic = params.initialConversation;
    const configObj: ConversationConfig = {};
    if (ic.autoApprove !== undefined) configObj.autoApprove = ic.autoApprove;
    if (ic.initialPrompt?.trim()) configObj.initialPrompt = ic.initialPrompt.trim();
    if (isNativeChatProvider(ic.provider)) {
      // Snapshot the conversation surface at creation time; the deferred
      // initial prompt is delivered by hydrateConversation through the
      // matching path (native turn vs. PTY keystrokes).
      const [projectRow] = await db
        .select({ workspaceProvider: projects.workspaceProvider })
        .from(projects)
        .where(eq(projects.id, params.projectId))
        .limit(1);
      const uiMode = resolveConversationUiMode({
        providerId: ic.provider,
        conversationUi: await appSettingsService.get('conversationUi'),
        isRemoteTask: wsTarget.kind === 'byoi' || projectRow?.workspaceProvider === 'ssh',
      });
      if (uiMode === 'native-chat') {
        configObj.uiMode = 'native-chat';
        applyNativeChatDefaults(
          configObj,
          (await appSettingsService.get('nativeChatDefaults'))[ic.provider]
        );
      }
    }
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

  // All inserts in a single atomic transaction.
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

    if (newWorkspaceValues) {
      tx.insert(workspaces).values(newWorkspaceValues).run();
    }

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
