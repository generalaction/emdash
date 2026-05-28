import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { createConversation } from '@main/core/conversations/createConversation';
import { getConversationById } from '@main/core/conversations/getConversationById';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { db } from '@main/db/client';
import { conversations, projects, tasks } from '@main/db/schema';
import {
  getProvider,
  isValidProviderId,
  type AgentProviderId,
} from '@shared/agent-provider-registry';
import type { Conversation } from '@shared/conversations';
import { makePtySessionId } from '@shared/ptySessionId';
import { HttpError, type CallerContext } from '../http-server';

export const ScopeSchema = z.enum(['task', 'project', 'all']);
export type Scope = z.infer<typeof ScopeSchema>;

export const SpawnBodySchema = z.object({
  providerId: z.string(),
  name: z.string().optional(),
  initialPrompt: z.string().optional(),
});
export type SpawnBody = z.infer<typeof SpawnBodySchema>;

export const SendBodySchema = z.object({
  message: z.string().min(1),
  crossTask: z.boolean().optional(),
  submit: z.boolean().optional(),
});
export type SendBody = z.infer<typeof SendBodySchema>;

export const InterruptBodySchema = z.object({
  crossTask: z.boolean().optional(),
});
export type InterruptBody = z.infer<typeof InterruptBodySchema>;

interface SelfResponse {
  conversationId: string;
  taskId: string;
  taskName?: string;
  projectId: string;
  projectName?: string;
  providerId: string;
  name: string;
}

interface PeerSummary extends SelfResponse {
  lastActivityAt: string | null;
  running: boolean;
}

async function lookupNames(
  taskIds: string[],
  projectIds: string[]
): Promise<{ taskNames: Map<string, string>; projectNames: Map<string, string> }> {
  const [taskRows, projectRows] = await Promise.all([
    taskIds.length
      ? db.select({ id: tasks.id, name: tasks.name }).from(tasks).where(inArray(tasks.id, taskIds))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    projectIds.length
      ? db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, projectIds))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);
  return {
    taskNames: new Map(taskRows.map((row) => [row.id, row.name])),
    projectNames: new Map(projectRows.map((row) => [row.id, row.name])),
  };
}

function getSessionId(conversation: Conversation): string {
  return makePtySessionId(conversation.projectId, conversation.taskId, conversation.id);
}

function assertCrossTaskWrite(
  caller: CallerContext,
  target: Conversation,
  crossTask: boolean | undefined,
  op: 'send' | 'interrupt'
): void {
  if (target.taskId === caller.conversation.taskId || crossTask) return;
  throw new HttpError(403, `cross-task ${op} requires crossTask=true`);
}

async function loadTargetConversation(targetConversationId: string): Promise<Conversation> {
  const target = await getConversationById(targetConversationId);
  if (!target) throw new HttpError(410, 'conversation gone');
  return target;
}

async function selectPeerRows(caller: CallerContext, scope: Scope) {
  switch (scope) {
    case 'task':
      return db
        .select()
        .from(conversations)
        .where(eq(conversations.taskId, caller.conversation.taskId));
    case 'project':
      return db
        .select()
        .from(conversations)
        .where(eq(conversations.projectId, caller.conversation.projectId));
    case 'all':
      return db.select().from(conversations);
  }
}

export async function handleAgentSelf(caller: CallerContext): Promise<SelfResponse> {
  const { taskNames, projectNames } = await lookupNames(
    [caller.conversation.taskId],
    [caller.conversation.projectId]
  );
  return {
    conversationId: caller.conversation.id,
    taskId: caller.conversation.taskId,
    taskName: taskNames.get(caller.conversation.taskId),
    projectId: caller.conversation.projectId,
    projectName: projectNames.get(caller.conversation.projectId),
    providerId: caller.conversation.providerId,
    name: caller.conversation.title,
  };
}

export async function handleAgentListPeers(
  caller: CallerContext,
  scope: Scope
): Promise<PeerSummary[]> {
  const rows = await selectPeerRows(caller, scope);
  const filtered = rows.filter((row) => row.id !== caller.conversation.id);
  const { taskNames, projectNames } = await lookupNames(
    Array.from(new Set(filtered.map((row) => row.taskId))),
    Array.from(new Set(filtered.map((row) => row.projectId)))
  );

  return filtered.map((row) => {
    const conversation = mapConversationRowToConversation(row);
    return {
      conversationId: conversation.id,
      taskId: conversation.taskId,
      taskName: taskNames.get(conversation.taskId),
      projectId: conversation.projectId,
      projectName: projectNames.get(conversation.projectId),
      providerId: conversation.providerId,
      name: conversation.title,
      lastActivityAt: conversation.lastInteractedAt,
      running: Boolean(ptySessionRegistry.get(getSessionId(conversation))),
    };
  });
}

export async function handleAgentSpawn(
  caller: CallerContext,
  body: SpawnBody
): Promise<{ conversationId: string; title: string; providerId: string }> {
  if (!isValidProviderId(body.providerId)) throw new HttpError(400, 'invalid providerId');
  const provider = body.providerId as AgentProviderId;
  const title = body.name ?? getProvider(provider)?.name ?? provider;
  const conversation = await createConversation({
    id: randomUUID(),
    projectId: caller.conversation.projectId,
    taskId: caller.conversation.taskId,
    provider,
    title,
    isInitialConversation: false,
    initialPrompt: body.initialPrompt,
  });
  return { conversationId: conversation.id, title: conversation.title, providerId: provider };
}

export async function handleAgentSend(
  caller: CallerContext,
  targetConversationId: string,
  body: SendBody
): Promise<{ ok: true }> {
  const target = await loadTargetConversation(targetConversationId);
  assertCrossTaskWrite(caller, target, body.crossTask, 'send');

  const pty = ptySessionRegistry.get(getSessionId(target));
  if (!pty) throw new HttpError(410, 'pty not running');

  pty.write(body.message);
  if ((body.submit ?? true) === true) {
    pty.write('\r');
  }
  return { ok: true };
}

export async function handleAgentInterrupt(
  caller: CallerContext,
  targetConversationId: string,
  body: InterruptBody
): Promise<{ ok: true }> {
  const target = await loadTargetConversation(targetConversationId);
  assertCrossTaskWrite(caller, target, body.crossTask, 'interrupt');

  const pty = ptySessionRegistry.get(getSessionId(target));
  if (!pty) throw new HttpError(410, 'pty not running');

  pty.write('\x03');
  return { ok: true };
}
