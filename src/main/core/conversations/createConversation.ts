import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { type Conversation, type CreateConversationParams } from '@shared/conversations';
import { withCompensation } from '@main/core/utils/compensation';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { resolveTask } from '../projects/utils';
import { taskManager } from '../tasks/task-manager';
import { workspaceRegistry } from '../workspaces/workspace-registry';
import { conversationEvents } from './conversation-events';
import { mapConversationRowToConversation } from './utils';

function pathToImageReference(path: string): string {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`;
}

function buildInitialPrompt(
  prompt: string | undefined,
  images: Array<{ name: string; path: string }>
): string | undefined {
  const trimmedPrompt = prompt?.trim() ?? '';
  const validImages = images.filter((image) => image.path);
  if (validImages.length === 0) return trimmedPrompt || undefined;

  const imagePrompt = validImages
    .map((image) => `- ${image.name}: ${pathToImageReference(image.path)}`)
    .join('\n');
  return [trimmedPrompt, 'Attached images:', imagePrompt].filter(Boolean).join('\n\n');
}

async function prepareInitialPrompt(params: CreateConversationParams): Promise<string | undefined> {
  const images = params.initialPromptImages ?? [];
  if (images.length === 0) return buildInitialPrompt(params.initialPrompt, []);

  const workspaceId = taskManager.getWorkspaceId(params.taskId);
  const workspace = workspaceId ? workspaceRegistry.get(workspaceId) : undefined;
  const copyLocalFileToTemp = workspace?.fs.copyLocalFileToTemp?.bind(workspace.fs);
  if (!copyLocalFileToTemp) return buildInitialPrompt(params.initialPrompt, images);

  const remoteImages = await Promise.all(
    images.map(async (image) => {
      try {
        return {
          ...image,
          path: await copyLocalFileToTemp(image.path, image.name),
        };
      } catch (error) {
        log.warn('Failed to copy initial prompt image to remote temp storage', {
          image: image.name,
          error,
        });
        return { ...image, path: '' };
      }
    })
  );
  return buildInitialPrompt(params.initialPrompt, remoteImages);
}

export async function createConversation(params: CreateConversationParams): Promise<Conversation> {
  const id = params.id ?? randomUUID();
  const [existingConversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.taskId, params.taskId))
    .limit(1);

  const config =
    params.autoApprove === undefined
      ? undefined
      : JSON.stringify({ autoApprove: params.autoApprove });

  const [row] = await db
    .insert(conversations)
    .values({
      id,
      projectId: params.projectId,
      taskId: params.taskId,
      title: params.title,
      provider: params.provider,
      config,
      isInitialConversation: params.isInitialConversation ?? false,
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      lastInteractedAt: new Date().toISOString(),
    })
    .returning();

  const task = resolveTask(params.projectId, params.taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  const conversation = mapConversationRowToConversation(row);

  await withCompensation({
    action: async () =>
      task.conversations.startSession(
        conversation,
        params.initialSize,
        false,
        await prepareInitialPrompt(params)
      ),
    compensate: async () => {
      await db.delete(conversations).where(eq(conversations.id, row.id)).execute();
    },
    onCompensationError: (error) => {
      log.error('createConversation: failed to roll back conversation row after spawn failure', {
        conversationId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  conversationEvents._emit('conversation:created', conversation);
  telemetryService.capture('conversation_created', {
    provider: params.provider,
    is_first_in_task: existingConversation === undefined,
    project_id: params.projectId,
    task_id: params.taskId,
    conversation_id: id,
  });

  return conversation;
}
