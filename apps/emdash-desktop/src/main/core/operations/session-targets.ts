import { makeTmuxSessionName } from '@emdash/core/services/pty/api';
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { createDesktopSessionIntentStores } from '@main/core/runtime/session-intent-stores';
import { db } from '@main/db/client';
import { conversations, tasks, terminals } from '@main/db/schema';
import type { LifecycleOperationRow } from '@main/db/schema';
import { getTerminalsRuntimeClient } from '@main/gateway/accessors';
import { log } from '@main/lib/logger';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import { nativePathFromHost } from '@shared/core/runtime/paths';
import type { OperationContext } from './operation-context';

export type SessionTargets = {
  acpConversationIds: string[];
  tuiConversationIds: string[];
  terminalSessionIds: string[];
  tmuxSessionNames: string[];
};

type SessionTargetSets = {
  [K in keyof SessionTargets]: Set<string>;
};

export async function resolveSessionTargets(
  operation: LifecycleOperationRow,
  context: OperationContext,
  options: { includeRuntimeTargets?: boolean } = {}
): Promise<SessionTargets> {
  const targets = payloadTargets(operation);
  if (operation.kind === 'cleanup-sessions') return toArrays(targets);

  const taskIds = await taskIdsForOperation(operation, context);
  if (taskIds.length > 0) {
    const [acpRows, tuiRows, terminalRows] = await Promise.all([
      db
        .select({
          id: conversations.id,
          taskId: conversations.taskId,
          projectId: conversations.projectId,
        })
        .from(conversations)
        .where(and(inArray(conversations.taskId, taskIds), eq(conversations.type, 'acp'))),
      db
        .select({
          id: conversations.id,
          taskId: conversations.taskId,
          projectId: conversations.projectId,
        })
        .from(conversations)
        .where(
          and(
            inArray(conversations.taskId, taskIds),
            or(ne(conversations.type, 'acp'), isNull(conversations.type))
          )
        ),
      db
        .select({ id: terminals.id, taskId: terminals.taskId, projectId: terminals.projectId })
        .from(terminals)
        .where(inArray(terminals.taskId, taskIds)),
    ]);

    for (const row of acpRows) targets.acpConversationIds.add(row.id);
    for (const row of tuiRows) targets.tuiConversationIds.add(row.id);
    for (const row of terminalRows) {
      targets.terminalSessionIds.add(makePtySessionId(row.projectId, row.taskId, row.id));
    }

    for (const row of [...acpRows, ...tuiRows, ...terminalRows]) {
      targets.tmuxSessionNames.add(
        makeTmuxSessionName(makePtySessionId(row.projectId, row.taskId, row.id))
      );
    }
  }

  if (
    options.includeRuntimeTargets !== false &&
    operation.kind !== 'delete-task' &&
    context.workspacePath
  ) {
    await addRuntimePathTargets(targets, operation, context.workspacePath);
  }

  return toArrays(targets);
}

async function taskIdsForOperation(
  operation: LifecycleOperationRow,
  context: OperationContext
): Promise<string[]> {
  if (operation.kind === 'delete-task') {
    return operation.taskId ? [operation.taskId] : [];
  }

  const workspaceId = operation.workspaceId ?? context.workspace?.id;
  if (!workspaceId) return [];
  // Include tombstoned tasks: their orphaned sessions still need to be stopped.
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.workspaceId, workspaceId));
  return rows.map((row) => row.id);
}

function payloadTargets(operation: LifecycleOperationRow): SessionTargetSets {
  return {
    acpConversationIds: new Set(operation.payload.acpConversationIds ?? []),
    tuiConversationIds: new Set(operation.payload.tuiConversationIds ?? []),
    terminalSessionIds: new Set(operation.payload.terminalSessionIds ?? []),
    tmuxSessionNames: new Set(operation.payload.tmuxSessionNames ?? []),
  };
}

function toArrays(targets: SessionTargetSets): SessionTargets {
  return {
    acpConversationIds: [...targets.acpConversationIds],
    tuiConversationIds: [...targets.tuiConversationIds],
    terminalSessionIds: [...targets.terminalSessionIds],
    tmuxSessionNames: [...targets.tmuxSessionNames],
  };
}

async function addRuntimePathTargets(
  targets: SessionTargetSets,
  operation: LifecycleOperationRow,
  workspacePath: string
): Promise<void> {
  const terminalScan = getTerminalsRuntimeClient()
    .then((client) => client.sessions.state(undefined, 'list').snapshot())
    .then((snapshot) => {
      for (const session of Object.values(snapshot.data)) {
        const sessionHostRef =
          session.key.workspace.host.type === 'local' ? 'local' : session.key.workspace.host.id;
        if (
          sessionHostRef === operation.hostRef &&
          nativePathFromHost(session.key.workspace.path) === workspacePath
        ) {
          targets.terminalSessionIds.add(session.key.id);
        }
      }
    })
    .catch((error) => {
      log.warn('lifecycle operation could not scan terminal runtime sessions', {
        workspacePath,
        error: String(error),
      });
    });

  const stores = createDesktopSessionIntentStores();
  const intentScans = [
    {
      store: stores.acp,
      target: targets.acpConversationIds,
    },
    {
      store: stores.tuiAgents,
      target: targets.tuiConversationIds,
      tmuxTarget: targets.tmuxSessionNames,
    },
  ].map(async ({ store, target, tmuxTarget }) => {
    const result = await store.list();
    if (!result.success) return;
    for (const intent of result.data) {
      if (readIntentStringField(intent.payload, 'cwd') === workspacePath) {
        target.add(intent.conversationId);
        const tmuxSessionName = readIntentStringField(intent.payload, 'tmuxSessionName');
        if (tmuxSessionName) tmuxTarget?.add(tmuxSessionName);
      }
    }
  });

  await Promise.all([terminalScan, ...intentScans]);
}

// Session intent payloads are provider-defined; keep runtime shape checks at this boundary.
function readIntentStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : undefined;
}
