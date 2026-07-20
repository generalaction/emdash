import { workspaceContract } from '@emdash/core/runtimes/workspace/api';
import { killTmuxSession } from '@emdash/core/services/pty/api';
import { err, ok, type Result } from '@emdash/shared';
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import {
  hostFileRefFromNativePath,
  hostPathFromNative,
} from '@core/primitives/desktop-runtime/api';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  projects,
  tasks,
  workspaces,
  type LifecycleOperationRow,
} from '@core/services/app-db/node/schema';
import { unregisterFileSearchRoot } from '@main/core/file-search/runtime-client';
import { projectManager } from '@main/core/projects/project-manager';
import { runRuntimeLiveJob } from '@main/core/runtime/live-job';
import { getAppDb } from '@main/db/instance';
import {
  getAcpRuntimeClient,
  getTerminalsRuntimeClient,
  getTuiAgentsRuntimeClient,
  getWorkspaceRuntimeClient,
} from '@main/gateway/accessors';
import { purgeProjectLocalState, purgeTaskLocalState } from '../local-cleanup';
import { resolveOperationContext } from '../operation-context';
import { operationStepFailed, workspaceInUseStepError } from '../operation-errors';
import type { OperationStepError, OperationStepKind } from '../operation-plan';
import { resolveSessionTargets } from '../session-targets';

type OperationStepResult = Result<void, OperationStepError>;

export type OperationStepRegistry = {
  execute(
    kind: OperationStepKind,
    operation: LifecycleOperationRow,
    signal?: AbortSignal
  ): Promise<OperationStepResult>;
};

export const operationStepRegistry: OperationStepRegistry = {
  async execute(kind, operation, signal) {
    if (signal?.aborted) return err(operationStepFailed('Operation cancelled'));
    try {
      switch (kind) {
        case 'kill-acp-sessions':
          return await killAcpSessions(operation);
        case 'kill-tui-sessions':
          return await killTuiAndTerminalSessions(operation);
        case 'deactivate-workspace':
          return await deactivateWorkspace(operation);
        case 'clean-artifacts':
          return await cleanArtifacts(operation);
        case 'teardown-workspace':
          return await teardownWorkspace(operation);
        case 'purge-task-rows':
          return await purgeTaskRows(operation);
        case 'purge-workspace-row':
          return await purgeWorkspaceRow(operation);
        case 'purge-project-row':
          return await purgeProjectRow(operation);
      }
    } catch (error) {
      return err(operationStepFailed(errorMessage(error)));
    }
  },
};

async function cleanArtifacts(operation: LifecycleOperationRow): Promise<OperationStepResult> {
  const context = await resolveOperationContext(operation, { resolveRuntimeConfig: true });
  if (!context.workspacePath || !context.projectPath) return ok();
  const hostId = operation.hostRef === 'local' ? undefined : operation.hostRef;
  const client = await getWorkspaceRuntimeClient();
  const result = await runRuntimeLiveJob(workspaceContract.cleanArtifacts, client.cleanArtifacts, {
    workspace: hostFileRefFromNativePath(context.workspacePath, hostId),
    repoPath: hostFileRefFromNativePath(context.projectPath, hostId),
    preservePatterns: context.preservePatterns,
  });
  if (!result.success && !isMissingError(result.error)) {
    return err(operationStepFailed(result.error.message));
  }
  return ok();
}

async function killAcpSessions(operation: LifecycleOperationRow): Promise<OperationStepResult> {
  const preconditionError = await workspaceDeletePreconditionError(operation);
  if (preconditionError) return err(preconditionError);
  const context = await resolveOperationContext(operation);
  const targets = await resolveSessionTargets(operation, context);
  if (targets.acpConversationIds.length === 0) return ok();

  const client = await getAcpRuntimeClient();
  for (const conversationId of targets.acpConversationIds) {
    const result = await client.killSession({ conversationId });
    if (!result.success && !isMissingError(result.error)) {
      return err(operationStepFailed(errorMessage(result.error)));
    }
  }
  return ok();
}

async function killTuiAndTerminalSessions(
  operation: LifecycleOperationRow
): Promise<OperationStepResult> {
  const preconditionError = await workspaceDeletePreconditionError(operation);
  if (preconditionError) return err(preconditionError);
  const context = await resolveOperationContext(operation);
  const targets = await resolveSessionTargets(operation, context);

  if (targets.tuiConversationIds.length > 0) {
    const tui = await getTuiAgentsRuntimeClient();
    for (const conversationId of targets.tuiConversationIds) {
      const result = await tui.deleteSession({ conversationId });
      if (!result.success && !isMissingError(result.error)) {
        return err(operationStepFailed(errorMessage(result.error)));
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
      const result = await terminalClient.kill({
        key: {
          workspace,
          id: sessionId,
        },
      });
      if (!result.success && !isMissingError(result.error)) {
        return err(operationStepFailed(errorMessage(result.error)));
      }
    }
  }

  if (!operation.projectId) return ok();
  const project = projectManager.getProject(operation.projectId);
  if (!project) return ok();
  await Promise.all(
    targets.tmuxSessionNames.map((sessionName) => killTmuxSession(project.ctx, sessionName))
  );
  return ok();
}

async function deactivateWorkspace(operation: LifecycleOperationRow): Promise<OperationStepResult> {
  const context = await resolveOperationContext(operation, { resolveRuntimeConfig: true });
  if (!context.workspacePath) return ok();
  const workspace = hostFileRefFromNativePath(
    context.workspacePath,
    operation.hostRef === 'local' ? undefined : operation.hostRef
  );
  const client = await getWorkspaceRuntimeClient();
  const consumerIds = await resolveDeactivateConsumers(operation, client, workspace);
  for (const consumerId of consumerIds) {
    const result = await runRuntimeLiveJob(workspaceContract.deactivate, client.deactivate, {
      workspace,
      consumerId,
      strategy: 'stop',
      automation: context.automation,
    });
    if (!result.success && !isMissingError(result.error)) {
      return err(operationStepFailed(result.error.message));
    }
  }
  return ok();
}

async function resolveDeactivateConsumers(
  operation: LifecycleOperationRow,
  client: Awaited<ReturnType<typeof getWorkspaceRuntimeClient>>,
  workspace: ReturnType<typeof hostFileRefFromNativePath>
): Promise<string[]> {
  if (operation.kind !== 'archive-workspace') {
    return [operation.taskId ?? operation.id];
  }

  // Archive removes every registered consumer so the runtime runs teardown once the last exits.
  const consumerIds = await client.workspace
    .state(workspace, 'state')
    .snapshot()
    .then((snapshot) => snapshot.data.consumers.map((consumer) => consumer.id))
    .catch(() => []);
  return consumerIds.length > 0 ? consumerIds : [operation.id];
}

async function teardownWorkspace(operation: LifecycleOperationRow): Promise<OperationStepResult> {
  if (operation.workspaceId && !(await workspaceIsUnused(getAppDb(), operation.workspaceId))) {
    if (operation.kind === 'delete-task') return ok();
    if (operation.kind === 'delete-workspace') {
      return err(workspaceInUseStepError());
    }
  }
  const context = await resolveOperationContext(operation, { resolveRuntimeConfig: true });
  if (
    operation.payload.deleteWorktree === false ||
    !context.workspacePath ||
    !context.projectPath ||
    context.workspaceKind === 'project-root'
  ) {
    return ok();
  }

  const lifecycleRef =
    context.workspaceKind === 'worktree'
      ? context.branchName
        ? {
            kind: 'worktree' as const,
            repoPath: context.projectPath,
            path: context.workspacePath,
            branchName: context.branchName,
          }
        : undefined
      : context.workspaceKind === 'byoi'
        ? { kind: 'directory' as const, path: context.workspacePath }
        : undefined;
  if (!lifecycleRef) return ok();

  const client = await getWorkspaceRuntimeClient();
  const result = await runRuntimeLiveJob(workspaceContract.teardown, client.teardown, {
    workspace: hostFileRefFromNativePath(
      context.workspacePath,
      operation.hostRef === 'local' ? undefined : operation.hostRef
    ),
    force: true,
    lifecycle: {
      ref: lifecycleRef,
      context: {
        repoPath: context.projectPath,
        preservePatterns: context.preservePatterns,
      },
      deleteBranch: operation.payload.deleteBranch !== false,
    },
  });
  if (!result.success && !isMissingError(result.error)) {
    return err(operationStepFailed(result.error.message));
  }
  return ok();
}

async function purgeTaskRows(operation: LifecycleOperationRow): Promise<OperationStepResult> {
  if (!operation.taskId) return ok();
  const context = await resolveOperationContext(operation);
  const purgeWorkspace =
    !!operation.workspaceId &&
    operation.payload.deleteWorktree !== false &&
    (await workspaceIsUnused(getAppDb(), operation.workspaceId));
  if (purgeWorkspace && context.workspacePath) {
    await unregisterFileSearchRoot(hostPathFromNative(context.workspacePath));
  }
  getAppDb().transaction((tx) => {
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
  return ok();
}

async function purgeWorkspaceRow(operation: LifecycleOperationRow): Promise<OperationStepResult> {
  if (!operation.workspaceId) return ok();
  const context = await resolveOperationContext(operation);
  if (!(await workspaceIsUnused(getAppDb(), operation.workspaceId))) return ok();
  if (context.workspacePath) {
    await unregisterFileSearchRoot(hostPathFromNative(context.workspacePath));
  }
  await getAppDb()
    .delete(workspaces)
    .where(
      and(
        eq(workspaces.id, operation.workspaceId),
        or(ne(workspaces.kind, 'project-root'), isNull(workspaces.kind))
      )
    );
  return ok();
}

async function purgeProjectRow(operation: LifecycleOperationRow): Promise<OperationStepResult> {
  if (!operation.projectId) return ok();
  await purgeProjectLocalState(operation.projectId, async () => {
    await getAppDb().delete(projects).where(eq(projects.id, operation.projectId!));
  });
  return ok();
}

async function workspaceIsUnused(tx: AppDb, workspaceId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)))
    .limit(1);
  return !row;
}

async function workspaceDeletePreconditionError(
  operation: LifecycleOperationRow
): Promise<OperationStepError | undefined> {
  if (
    operation.kind === 'delete-workspace' &&
    operation.workspaceId &&
    !(await workspaceIsUnused(getAppDb(), operation.workspaceId))
  ) {
    return workspaceInUseStepError();
  }
  return undefined;
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
