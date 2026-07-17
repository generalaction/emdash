import {
  createIdleSweeper,
  type IdleSweeper,
  type IoActivitySnapshot,
} from '@emdash/core/primitives/io-activity/api';
import { decodeTmuxSessionName, listTmuxSessionActivity } from '@emdash/core/services/pty/api';
import type { Scope } from '@emdash/shared/concurrency';
import { eq, isNotNull, isNull } from 'drizzle-orm';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import { makePtySessionId, parsePtySessionId } from '@core/primitives/pty/api';
import { appScope } from '@main/bootstrap/app-scope';
import { agentStatusService } from '@main/core/agent-status/agent-status-service';
import { projectManager } from '@main/core/projects/project-manager';
import { createDesktopSessionIntentStores } from '@main/core/runtime/session-intent-stores';
import { listProjectWorkspaces } from '@main/core/workspaces/operations/list-project-workspaces';
import { db } from '@main/db/client';
import { conversations, projects, tasks, terminals, workspaces } from '@main/db/schema';
import {
  getAcpRuntimeClient,
  getTerminalsRuntimeClient,
  getTuiAgentsRuntimeClient,
} from '@main/gateway/accessors';
import { log } from '@main/lib/logger';
import type { OperationsService, ReconcilerSessionCleanupInput } from './operations-service';
import { shouldProposeWorkspaceCleanup } from './reconciliation-policy';

const RECONCILE_INTERVAL_MS = 10 * 60_000;
const SWEEP_ENTRY = 'lifecycle-drift';
const SWEEP_SNAPSHOT: IoActivitySnapshot = {
  running: false,
  busy: false,
  attachedClients: 0,
  detachedAt: null,
  lastInputAt: null,
  lastOutputAt: null,
};

type TaskOwner = {
  taskId: string;
  projectId: string;
  taskDeletedAt: string | null;
  projectDeletedAt: string | null;
  projectPath: string;
  workspacePath: string | null;
  hostRef: string;
};

type SessionCandidate = ReconcilerSessionCleanupInput & {
  acpConversationIds: string[];
  tuiConversationIds: string[];
  terminalSessionIds: string[];
  tmuxSessionNames: string[];
};

let reconciler: IdleSweeper | undefined;

export function startLifecycleReconciler(
  operations: OperationsService,
  scope: Scope = appScope
): IdleSweeper {
  if (reconciler) return reconciler;
  reconciler = createIdleSweeper({
    scope,
    intervalMs: RECONCILE_INTERVAL_MS,
    entries: () => [SWEEP_ENTRY],
    snapshot: () => SWEEP_SNAPSHOT,
    policy: () => () => ({ action: 'deactivate', reason: 'reconcile' }),
    deactivate: () => sweepLifecycleDrift(operations),
    onError: (error) => log.warn('lifecycle reconciler sweep failed', { error: String(error) }),
  });
  void reconciler.sweepNow();
  return reconciler;
}

export async function sweepLifecycleDrift(operations: OperationsService): Promise<void> {
  const [taskOwners, conversationOwners, terminalOwners] = await Promise.all([
    loadTaskOwners(),
    loadConversationOwners(),
    loadTerminalOwners(),
  ]);
  const ownerByTaskId = new Map(taskOwners.map((owner) => [owner.taskId, owner]));
  const ownerByWorkspacePath = new Map(
    taskOwners
      .filter((owner): owner is TaskOwner & { workspacePath: string } => !!owner.workspacePath)
      .map((owner) => [owner.workspacePath, owner])
  );
  const conversationOwnerById = new Map(
    conversationOwners.map((owner) => [owner.conversationId, owner])
  );
  const terminalOwnerBySessionId = new Map(terminalOwners.map((owner) => [owner.sessionId, owner]));
  const validConversationIds = new Set(
    conversationOwners.filter(isOwnerActive).map((owner) => owner.conversationId)
  );
  const validTerminalSessionIds = new Set(
    terminalOwners.filter(isOwnerActive).map((owner) => owner.sessionId)
  );

  const invalidTaskIds = new Set(
    taskOwners.filter((owner) => !isOwnerActive(owner)).map((owner) => owner.taskId)
  );
  for (const taskId of invalidTaskIds) {
    await operations.proposeReconcilerTaskCleanup(taskId);
  }
  for (const projectId of await loadTombstonedProjectIds()) {
    await operations.proposeReconcilerProjectCleanup(projectId);
  }

  const intentContext = await loadAndPruneSessionIntents(validConversationIds);
  for (const owner of conversationOwners.filter((candidate) => !isOwnerActive(candidate))) {
    await agentStatusService.resetToIdle({ conversationId: owner.conversationId });
  }

  const [acpClient, tuiClient, terminalsClient] = await Promise.all([
    getAcpRuntimeClient(),
    getTuiAgentsRuntimeClient(),
    getTerminalsRuntimeClient(),
  ]);
  const [acpSessions, tuiSessions, terminalSessions] = await Promise.all([
    acpClient.sessions.state(undefined, 'list').snapshot(),
    tuiClient.sessions.state(undefined, 'list').snapshot(),
    terminalsClient.sessions.state(undefined, 'list').snapshot(),
  ]);
  const candidates = new Map<string, SessionCandidate>();

  for (const conversationId of Object.keys(acpSessions.data)) {
    if (validConversationIds.has(conversationId)) continue;
    const owner =
      conversationOwnerById.get(conversationId) ??
      ownerByWorkspacePath.get(intentContext.get(conversationId) ?? '');
    sessionCandidate(candidates, `conversation:${conversationId}`, owner).acpConversationIds.push(
      conversationId
    );
  }
  for (const conversationId of Object.keys(tuiSessions.data)) {
    if (validConversationIds.has(conversationId)) continue;
    const owner =
      conversationOwnerById.get(conversationId) ??
      ownerByWorkspacePath.get(intentContext.get(conversationId) ?? '');
    sessionCandidate(candidates, `conversation:${conversationId}`, owner).tuiConversationIds.push(
      conversationId
    );
  }
  for (const session of Object.values(terminalSessions.data)) {
    if (validTerminalSessionIds.has(session.key.id)) continue;
    const parsed = parsePtySessionId(session.key.id);
    const owner =
      terminalOwnerBySessionId.get(session.key.id) ??
      (parsed ? ownerByTaskId.get(parsed.scopeId) : undefined);
    const candidate = sessionCandidate(candidates, `pty:${session.key.id}`, owner);
    candidate.projectId ??= parsed?.projectId;
    candidate.workspacePath ??= nativePathFromHost(session.key.workspace.path);
    candidate.hostRef ??=
      session.key.workspace.host.type === 'local' ? 'local' : session.key.workspace.host.id;
    candidate.terminalSessionIds.push(session.key.id);
  }

  const wantedTmuxSessionIds = new Set([
    ...conversationOwners
      .filter(isOwnerActive)
      .map((owner) => makePtySessionId(owner.projectId, owner.taskId, owner.conversationId)),
    ...validTerminalSessionIds,
  ]);
  for (const project of await loadActiveProjects()) {
    const provider = projectManager.getProject(project.id);
    if (!provider) continue;
    try {
      const activity = await listTmuxSessionActivity(provider.ctx);
      for (const sessionName of activity.keys()) {
        const sessionId = decodeTmuxSessionName(sessionName);
        if (!sessionId || wantedTmuxSessionIds.has(sessionId)) continue;
        const parsed = parsePtySessionId(sessionId);
        if (!parsed || parsed.projectId !== project.id) continue;
        const owner = ownerByTaskId.get(parsed.scopeId);
        const candidate = sessionCandidate(candidates, `pty:${sessionId}`, owner);
        candidate.projectId ??= parsed.projectId;
        candidate.hostRef ??= project.sshConnectionId ?? 'local';
        candidate.tmuxSessionNames.push(sessionName);
      }
    } catch (error) {
      log.warn('lifecycle reconciler tmux scan failed', {
        projectId: project.id,
        error: String(error),
      });
    }
  }

  for (const candidate of candidates.values()) {
    await operations.proposeReconcilerSessionCleanup(candidate);
  }

  for (const project of await loadActiveProjects()) {
    try {
      const result = await listProjectWorkspaces(project.id);
      for (const row of result.rows) {
        if (!shouldProposeWorkspaceCleanup(row, project.path)) continue;
        await operations.proposeReconcilerWorkspaceCleanup({
          projectId: project.id,
          workspaceId: row.workspaceId ?? undefined,
          workspacePath: row.path,
          branchName: row.branch,
        });
      }
    } catch (error) {
      log.warn('lifecycle reconciler workspace scan failed', {
        projectId: project.id,
        error: String(error),
      });
    }
  }
}

function sessionCandidate(
  candidates: Map<string, SessionCandidate>,
  key: string,
  owner?: TaskOwner
): SessionCandidate {
  const existing = candidates.get(key);
  if (existing) return existing;
  const candidate: SessionCandidate = {
    entityId: `reconciler-session:${key}`,
    projectId: owner?.projectId,
    workspacePath: owner?.workspacePath ?? undefined,
    hostRef: owner?.hostRef,
    acpConversationIds: [],
    tuiConversationIds: [],
    terminalSessionIds: [],
    tmuxSessionNames: [],
  };
  candidates.set(key, candidate);
  return candidate;
}

async function loadTaskOwners(): Promise<TaskOwner[]> {
  return db
    .select({
      taskId: tasks.id,
      projectId: tasks.projectId,
      taskDeletedAt: tasks.deletedAt,
      projectDeletedAt: projects.deletedAt,
      projectPath: projects.path,
      workspacePath: workspaces.path,
      workspaceSshConnectionId: workspaces.sshConnectionId,
      projectSshConnectionId: projects.sshConnectionId,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .then((rows) =>
      rows.map(({ workspaceSshConnectionId, projectSshConnectionId, ...owner }) => ({
        ...owner,
        hostRef: workspaceSshConnectionId ?? projectSshConnectionId ?? 'local',
      }))
    );
}

async function loadConversationOwners() {
  return db
    .select({
      conversationId: conversations.id,
      taskId: tasks.id,
      projectId: tasks.projectId,
      taskDeletedAt: tasks.deletedAt,
      projectDeletedAt: projects.deletedAt,
      projectPath: projects.path,
      workspacePath: workspaces.path,
      workspaceSshConnectionId: workspaces.sshConnectionId,
      projectSshConnectionId: projects.sshConnectionId,
    })
    .from(conversations)
    .innerJoin(tasks, eq(tasks.id, conversations.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .then((rows) =>
      rows.map(({ workspaceSshConnectionId, projectSshConnectionId, ...owner }) => ({
        ...owner,
        hostRef: workspaceSshConnectionId ?? projectSshConnectionId ?? 'local',
      }))
    );
}

async function loadTerminalOwners() {
  return db
    .select({
      terminalId: terminals.id,
      taskId: tasks.id,
      projectId: tasks.projectId,
      taskDeletedAt: tasks.deletedAt,
      projectDeletedAt: projects.deletedAt,
      projectPath: projects.path,
      workspacePath: workspaces.path,
      workspaceSshConnectionId: workspaces.sshConnectionId,
      projectSshConnectionId: projects.sshConnectionId,
    })
    .from(terminals)
    .innerJoin(tasks, eq(tasks.id, terminals.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .then((rows) =>
      rows.map(({ terminalId, workspaceSshConnectionId, projectSshConnectionId, ...owner }) => ({
        ...owner,
        terminalId,
        sessionId: `${owner.projectId}:${owner.taskId}:${terminalId}`,
        hostRef: workspaceSshConnectionId ?? projectSshConnectionId ?? 'local',
      }))
    );
}

async function loadActiveProjects(): Promise<
  Array<{ id: string; path: string; sshConnectionId: string | null }>
> {
  return db
    .select({
      id: projects.id,
      path: projects.path,
      sshConnectionId: projects.sshConnectionId,
    })
    .from(projects)
    .where(isNull(projects.deletedAt));
}

async function loadTombstonedProjectIds(): Promise<string[]> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(isNotNull(projects.deletedAt));
  return rows.map((row) => row.id);
}

async function loadAndPruneSessionIntents(
  validConversationIds: Set<string>
): Promise<Map<string, string>> {
  const intentStores = createDesktopSessionIntentStores();
  const stores = [intentStores.acp, intentStores.tuiAgents];
  const context = new Map<string, string>();
  for (const store of stores) {
    const result = await store.list();
    if (!result.success) {
      log.warn('lifecycle reconciler could not read session intents', {
        error: result.error.message,
      });
      continue;
    }
    for (const intent of result.data) {
      const cwd = stringField(intent.payload, 'cwd');
      if (cwd) context.set(intent.conversationId, cwd);
      if (!validConversationIds.has(intent.conversationId)) {
        const removed = await store.remove(intent.conversationId);
        if (!removed.success) {
          log.warn('lifecycle reconciler could not prune session intent', {
            conversationId: intent.conversationId,
            error: removed.error.message,
          });
        }
      }
    }
  }
  return context;
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : undefined;
}

function isOwnerActive(owner: {
  taskDeletedAt: string | null;
  projectDeletedAt: string | null;
}): boolean {
  return owner.taskDeletedAt === null && owner.projectDeletedAt === null;
}
