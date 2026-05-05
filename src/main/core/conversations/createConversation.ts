import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { type Conversation, type CreateConversationParams } from '@shared/conversations';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { resolveTask } from '../projects/utils';
import { taskManager } from '../tasks/task-manager';
import { workspaceRegistry } from '../workspaces/workspace-registry';
import { mapConversationRowToConversation } from './utils';

function buildInitialPrompt(
  prompt: string | undefined,
  images: Array<{ name: string; path: string }>
): string | undefined {
  const trimmedPrompt = prompt?.trim() ?? '';
  const validImages = images.filter((image) => image.path);
  if (validImages.length === 0) return trimmedPrompt || undefined;

  const imagePrompt = validImages.map((image) => `- ${image.name}: ${image.path}`).join('\n');
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
      log.warn('Workspace has no copyLocalFile — initial prompt images will use temp paths');
    }
    return buildInitialPrompt(params.initialPrompt, images);
  }

  const imageDir = '.emdash/initial-prompt-images';
  try {
    await workspace.fs.mkdir(imageDir, { recursive: true });
  } catch (error) {
    log.warn('Failed to create image directory in workspace — using temp paths', { error });
    return buildInitialPrompt(params.initialPrompt, images);
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
        return image;
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
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  const task = resolveTask(params.projectId, params.taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  const conversation = mapConversationRowToConversation(row);

  await task.conversations.startSession(
    conversation,
    params.initialSize,
    false,
    await prepareInitialPrompt(params)
  );
  telemetryService.capture('conversation_created', {
    provider: params.provider,
    is_first_in_task: existingConversation === undefined,
    project_id: params.projectId,
    task_id: params.taskId,
    conversation_id: id,
  });

  return mapConversationRowToConversation(row);
}
