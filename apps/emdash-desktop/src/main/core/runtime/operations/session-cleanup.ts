import { makeTmuxSessionName } from '@emdash/core/services/pty/api';
import { killTmuxSession } from '@emdash/core/services/pty/api';
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import {
  hostFileRefFromNativePath,
  nativePathFromHost,
} from '@core/primitives/desktop-runtime/api';
import { makePtySessionId } from '@core/primitives/pty/api';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  conversations,
  tasks,
  terminals,
  type LifecycleOperationRow,
} from '@core/services/app-db/node/schema';
import { projectManager } from '@main/core/projects/project-manager';
import { createDesktopSessionIntentStores } from '@main/core/runtime/session-intent-stores';
import {
  lifecycleWorkspaceIsUnused,
  WorkspaceInUseError,
} from '@main/core/workspaces/operations/lifecycle-cleanup';
import type { LifecycleOperationContext } from '@main/core/workspaces/operations/lifecycle-operation-context';
import {
  getAcpRuntimeClient,
  getTerminalsRuntimeClient,
  getTuiAgentsRuntimeClient,
} from '@main/gateway/accessors';
import { log } from '@main/lib/logger';

export type LifecycleSessionTargets = {
  acpConversationIds: string[];
  tuiConversationIds: string[];
  terminalSessionIds: string[];
  tmuxSessionNames: string[];
};

type SessionTargetSets = {
  [K in keyof LifecycleSessionTargets]: Set<string>;
};

export async function resolveLifecycleSessionTargets(
  db: AppDb,
  operation: LifecycleOperationRow,
  context: LifecycleOperationContext,
  options: { includeRuntimeTargets?: boolean } = {}
): Promise<LifecycleSessionTargets> {
  const targets = payloadTargets(operation);
  if (operation.kind === 'cleanup-sessions') return toArrays(targets);

  const taskIds = await taskIdsForOperation(db, operation, context);
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

export async function killLifecycleAcpSessions(
  db: AppDb,
  operation: LifecycleOperationRow,
  targets: LifecycleSessionTargets
): Promise<void> {
  await assertWorkspaceDeleteAllowed(db, operation);
  if (targets.acpConversationIds.length === 0) return;
  const client = await getAcpRuntimeClient();
  for (const conversationId of targets.acpConversationIds) {
    const result = await client.killSession({ conversationId });
    if (!result.success && !isMissingError(result.error)) {
      throw new Error(errorMessage(result.error));
    }
  }
}

export async function killLifecycleTerminalSessions(
  db: AppDb,
  operation: LifecycleOperationRow,
  context: LifecycleOperationContext,
  targets: LifecycleSessionTargets
): Promise<void> {
  await assertWorkspaceDeleteAllowed(db, operation);
  if (targets.tuiConversationIds.length > 0) {
    const tui = await getTuiAgentsRuntimeClient();
    for (const conversationId of targets.tuiConversationIds) {
      const result = await tui.deleteSession({ conversationId });
      if (!result.success && !isMissingError(result.error)) {
        throw new Error(errorMessage(result.error));
      }
    }
  }

  if (context.workspacePath) {
    const terminalClient = await getTerminalsRuntimeClient();
    const workspace = hostFileRefFromNativePath(
      context.workspacePath,
      operation.hostRef === 'local' ? undefined : operation.hostRef
    );
    for (const sessionId of targets.terminalSessionIds) {
      const result = await terminalClient.kill({ key: { workspace, id: sessionId } });
      if (!result.success && !isMissingError(result.error)) {
        throw new Error(errorMessage(result.error));
      }
    }
  }

  if (!operation.projectId) return;
  const project = projectManager.getProject(operation.projectId);
  if (!project) return;
  await Promise.all(
    targets.tmuxSessionNames.map((sessionName) => killTmuxSession(project.ctx, sessionName))
  );
}

function payloadTargets(operation: LifecycleOperationRow): SessionTargetSets {
  return {
    acpConversationIds: new Set(operation.payload.acpConversationIds ?? []),
    tuiConversationIds: new Set(operation.payload.tuiConversationIds ?? []),
    terminalSessionIds: new Set(operation.payload.terminalSessionIds ?? []),
    tmuxSessionNames: new Set(operation.payload.tmuxSessionNames ?? []),
  };
}

function toArrays(targets: SessionTargetSets): LifecycleSessionTargets {
  return {
    acpConversationIds: [...targets.acpConversationIds],
    tuiConversationIds: [...targets.tuiConversationIds],
    terminalSessionIds: [...targets.terminalSessionIds],
    tmuxSessionNames: [...targets.tmuxSessionNames],
  };
}

async function taskIdsForOperation(
  db: AppDb,
  operation: LifecycleOperationRow,
  context: LifecycleOperationContext
): Promise<string[]> {
  if (operation.kind === 'delete-task') {
    return operation.taskId ? [operation.taskId] : [];
  }
  const workspaceId = operation.workspaceId ?? context.workspace?.id;
  if (!workspaceId) return [];
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.workspaceId, workspaceId));
  return rows.map((row) => row.id);
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
    { store: stores.acp, target: targets.acpConversationIds },
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

async function assertWorkspaceDeleteAllowed(
  db: AppDb,
  operation: LifecycleOperationRow
): Promise<void> {
  if (
    operation.kind === 'delete-workspace' &&
    operation.workspaceId &&
    !(await lifecycleWorkspaceIsUnused(db, operation.workspaceId))
  ) {
    throw new WorkspaceInUseError();
  }
}

function isMissingError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('type' in error)) return false;
  const type = String(error.type);
  return type === 'not-found' || type === 'workspace-not-found' || type === 'missing-workspace';
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}

function readIntentStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : undefined;
}
