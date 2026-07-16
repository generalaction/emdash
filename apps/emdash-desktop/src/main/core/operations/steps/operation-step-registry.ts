import { workspaceContract } from '@emdash/core/runtimes/workspace/api';
import { killTmuxSession, makeTmuxSessionName } from '@emdash/core/services/pty/api';
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import { unregisterFileSearchRoot } from '@main/core/file-search/runtime-client';
import { projectManager } from '@main/core/projects/project-manager';
import { runRuntimeLiveJob } from '@main/core/runtime/live-job';
import { getTaskSessionLeafIds } from '@main/core/tasks/session-targets';
import {
  getAcpRuntimeClient,
  getTerminalsRuntimeClient,
  getTuiAgentsRuntimeClient,
} from '@main/core/wire-workers/accessors';
import {
  getWorkspaceRuntimeClient,
  hostFileRefFromNativePath,
} from '@main/core/workspaces/runtime/workspace-runtime-host';
import { db } from '@main/db/client';
import {
  conversations,
  projects,
  tasks,
  terminals,
  workspaces,
  type LifecycleOperationRow,
} from '@main/db/schema';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import { hostPathFromNative } from '@shared/core/runtime/paths';
import { purgeProjectLocalState, purgeTaskLocalState } from '../local-cleanup';
import { resolveOperationContext } from '../operation-context';
import type { OperationStepKind } from '../operation-plan';

export type OperationStepRegistry = {
  execute(
    kind: OperationStepKind,
    operation: LifecycleOperationRow,
    signal?: AbortSignal
  ): Promise<void>;
};

export const operationStepRegistry: OperationStepRegistry = {
  async execute(kind, operation, signal) {
    if (signal?.aborted) throw new Error('Operation cancelled');
    switch (kind) {
      case 'kill-acp-sessions':
        return killAcpSessions(operation);
      case 'kill-tui-sessions':
        return killTuiAndTerminalSessions(operation);
      case 'deactivate-workspace':
        return deactivateWorkspace(operation);
      case 'teardown-workspace':
        return teardownWorkspace(operation);
      case 'purge-task-rows':
        return purgeTaskRows(operation);
      case 'purge-workspace-row':
        return purgeWorkspaceRow(operation);
      case 'purge-project-row':
        return purgeProjectRow(operation);
    }
  },
};

async function killAcpSessions(operation: LifecycleOperationRow): Promise<void> {
  const rows = operation.taskId
    ? await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.taskId, operation.taskId), eq(conversations.type, 'acp')))
    : [];
  const conversationIds = new Set([
    ...rows.map((row) => row.id),
    ...(operation.payload.acpConversationIds ?? []),
  ]);
  if (conversationIds.size === 0) return;

  const client = await getAcpRuntimeClient();
  for (const conversationId of conversationIds) {
    const result = await client.killSession({ conversationId });
    if (!result.success && !isMissingError(result.error)) {
      throw new Error(errorMessage(result.error));
    }
  }
}

async function killTuiAndTerminalSessions(operation: LifecycleOperationRow): Promise<void> {
  const context = await resolveOperationContext(operation);
  const [conversationRows, terminalRows] = operation.taskId
    ? await Promise.all([
        db
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            and(
              eq(conversations.taskId, operation.taskId),
              or(ne(conversations.type, 'acp'), isNull(conversations.type))
            )
          ),
        db
          .select({ id: terminals.id })
          .from(terminals)
          .where(eq(terminals.taskId, operation.taskId)),
      ])
    : [[], []];
  const conversationIds = new Set([
    ...conversationRows.map((row) => row.id),
    ...(operation.payload.tuiConversationIds ?? []),
  ]);

  if (conversationIds.size > 0) {
    const tui = await getTuiAgentsRuntimeClient();
    for (const conversationId of conversationIds) {
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
    const terminalSessionIds = new Set(operation.payload.terminalSessionIds ?? []);
    if (operation.projectId && operation.taskId) {
      for (const row of terminalRows) {
        terminalSessionIds.add(makePtySessionId(operation.projectId, operation.taskId, row.id));
      }
    }
    for (const sessionId of terminalSessionIds) {
      const result = await terminalClient.kill({
        key: {
          workspace,
          id: sessionId,
        },
      });
      if (!result.success && !isMissingError(result.error)) {
        throw new Error(errorMessage(result.error));
      }
    }
  }

  if (!operation.projectId) return;
  const project = projectManager.getProject(operation.projectId);
  if (!project) return;
  const tmuxSessionNames = new Set(operation.payload.tmuxSessionNames ?? []);
  if (operation.taskId) {
    const { conversationIds: taskConversationIds, terminalIds } = await getTaskSessionLeafIds(
      operation.projectId,
      operation.taskId
    );
    for (const leafId of [...taskConversationIds, ...terminalIds]) {
      tmuxSessionNames.add(
        makeTmuxSessionName(makePtySessionId(operation.projectId, operation.taskId, leafId))
      );
    }
  }
  await Promise.all(
    [...tmuxSessionNames].map((sessionName) => killTmuxSession(project.ctx, sessionName))
  );
}

async function deactivateWorkspace(operation: LifecycleOperationRow): Promise<void> {
  const context = await resolveOperationContext(operation, { resolveRuntimeConfig: true });
  if (!operation.taskId || !context.workspacePath) return;
  const client = await getWorkspaceRuntimeClient();
  const result = await runRuntimeLiveJob(workspaceContract.deactivate, client.deactivate, {
    workspace: hostFileRefFromNativePath(
      context.workspacePath,
      operation.hostRef === 'local' ? undefined : operation.hostRef
    ),
    consumerId: operation.taskId,
    strategy: 'stop',
    automation: context.automation,
  });
  if (!result.success && !isMissingError(result.error)) {
    throw new Error(result.error.message);
  }
}

async function teardownWorkspace(operation: LifecycleOperationRow): Promise<void> {
  const context = await resolveOperationContext(operation, { resolveRuntimeConfig: true });
  if (
    operation.payload.deleteWorktree === false ||
    context.workspaceKind !== 'worktree' ||
    !context.workspacePath ||
    !context.projectPath ||
    !context.branchName
  ) {
    return;
  }

  const client = await getWorkspaceRuntimeClient();
  const result = await runRuntimeLiveJob(workspaceContract.teardown, client.teardown, {
    workspace: hostFileRefFromNativePath(
      context.workspacePath,
      operation.hostRef === 'local' ? undefined : operation.hostRef
    ),
    force: true,
    lifecycle: {
      ref: {
        kind: 'worktree',
        repoPath: context.projectPath,
        path: context.workspacePath,
        branchName: context.branchName,
      },
      context: {
        repoPath: context.projectPath,
        preservePatterns: context.preservePatterns,
      },
    },
  });
  if (!result.success && !isMissingError(result.error)) {
    throw new Error(result.error.message);
  }
}

async function purgeTaskRows(operation: LifecycleOperationRow): Promise<void> {
  if (!operation.taskId) return;
  const context = await resolveOperationContext(operation);
  const purgeWorkspace =
    !!operation.workspaceId &&
    operation.payload.deleteWorktree !== false &&
    (await workspaceIsUnused(db, operation.workspaceId));
  if (purgeWorkspace && context.workspacePath) {
    await unregisterFileSearchRoot(hostPathFromNative(context.workspacePath));
  }
  db.transaction((tx) => {
    tx.delete(tasks).where(eq(tasks.id, operation.taskId!)).run();
    if (operation.workspaceId && purgeWorkspace) {
      tx.delete(workspaces)
        .where(
          and(
            eq(workspaces.id, operation.workspaceId),
            or(ne(workspaces.kind, 'project-root'), isNull(workspaces.kind))
          )
        )
        .run();
    }
  });
  await purgeTaskLocalState({
    projectId: operation.projectId,
    taskId: operation.taskId,
  });
}

async function purgeWorkspaceRow(operation: LifecycleOperationRow): Promise<void> {
  if (!operation.workspaceId) return;
  const context = await resolveOperationContext(operation);
  if (!(await workspaceIsUnused(db, operation.workspaceId))) return;
  if (context.workspacePath) {
    await unregisterFileSearchRoot(hostPathFromNative(context.workspacePath));
  }
  await db
    .delete(workspaces)
    .where(
      and(
        eq(workspaces.id, operation.workspaceId),
        or(ne(workspaces.kind, 'project-root'), isNull(workspaces.kind))
      )
    );
}

async function purgeProjectRow(operation: LifecycleOperationRow): Promise<void> {
  if (!operation.projectId) return;
  await purgeProjectLocalState(operation.projectId, async () => {
    await db.delete(projects).where(eq(projects.id, operation.projectId!));
  });
}

async function workspaceIsUnused(tx: typeof db, workspaceId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)))
    .limit(1);
  return !row;
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
