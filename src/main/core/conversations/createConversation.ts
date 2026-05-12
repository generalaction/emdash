import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
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
  const copyLocalFile = workspace?.fs.copyLocalFile?.bind(workspace.fs);
  if (!workspace || !copyLocalFile) {
    if (workspace && !copyLocalFile) {
      log.warn('Workspace has no copyLocalFile — omitting initial prompt images');
    }
    return buildInitialPrompt(params.initialPrompt, []);
  }

  const imageDir = '.emdash/initial-prompt-images';
  try {
    await workspace.fs.mkdir(imageDir, { recursive: true });
  } catch (error) {
    log.warn('Failed to create image directory in workspace — omitting initial prompt images', {
      error,
    });
    return buildInitialPrompt(params.initialPrompt, []);
  }
  const remoteImages = await Promise.all(
    images.map(async (image) => {
      try {
        const safeName = basename(image.name).replace(/[^a-zA-Z0-9._ -]/g, '_');
        const remotePath = `${imageDir}/${randomUUID()}-${safeName}`;
        await copyLocalFile(image.path, remotePath);
        return { ...image, path: `${workspace.path}/${remotePath}` };
      } catch (error) {
        log.warn('Failed to copy initial prompt image to workspace', { image: image.name, error });
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
