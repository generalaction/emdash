import { LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import { err, type Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type { LiveModelProvider, LiveSource } from '@emdash/wire';
import {
  createController,
  type CallMeta,
  type Controller,
  type LiveModelDef,
} from '@emdash/wire/api';
import { and, eq } from 'drizzle-orm';
import { createConversationOperations } from '@core/features/conversations/node/controller';
import type { CompensationRunner } from '@core/features/conversations/node/createConversation';
import { setConversationModeId } from '@core/features/conversations/node/set-mode-id';
import { setSessionId } from '@core/features/conversations/node/set-session-id';
import { touchConversation } from '@core/features/conversations/node/touchConversation';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import type { TaskSessionManager } from '@core/features/tasks/api/node/task-session-manager';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb } from '@core/services/app-db/node/db';
import { conversations, tasks } from '@core/services/app-db/node/schema';
import { conversationsContract } from '../api';
import {
  throwConversationsRuntimeResolveError,
  type ConversationsAcpStartInput,
  type ConversationsHostRuntimesClient,
  type ConversationsRuntimeBroker,
  type ConversationsRuntimeResolveError as RuntimeResolveError,
} from '../api/runtime-adapter';
import { conversationWireEvents } from './event-host';

type ConversationRuntimeTarget = Readonly<{
  conversationId: string;
  projectId: string;
  taskId: string;
  conversationType: 'pty' | 'acp';
  providerId: string | null;
  sessionId: string | null;
  modeId: string | null;
  workspacePath?: string;
  host: HostRef;
  acpInput?: ConversationsAcpStartInput;
}>;

type WorkspaceIdentityResolver = Readonly<{
  resolve(workspaceId: string): Promise<{ host: HostRef; path: string } | null>;
}>;

type ConversationRuntimeHooks = Readonly<{
  persistAcpSessionId(target: ConversationRuntimeTarget, sessionId: string): Promise<void>;
  persistAcpMode(target: ConversationRuntimeTarget, modeId: string): Promise<void>;
  recordTuiInput(target: ConversationRuntimeTarget): Promise<void>;
}>;

export type CreateConversationsWireControllerOptions = Readonly<{
  db: AppDb;
  runtimes: ConversationsRuntimeBroker;
  workspaceIdentity: WorkspaceIdentityResolver;
  resolveTarget?: (conversationId: string) => Promise<ConversationRuntimeTarget>;
  hooks?: ConversationRuntimeHooks;
  getProviderEnv?: (providerId: string) => Promise<Record<string, string> | undefined>;
  logger: Logger;
  projects: Pick<ProjectSessionManager, 'getProject'>;
  telemetry: TelemetryService;
  taskSessions: Pick<TaskSessionManager, 'getTask'>;
  withCompensation: CompensationRunner;
}>;

export function createConversationsWireController(
  options: CreateConversationsWireControllerOptions
): Controller {
  const resolveTarget =
    options.resolveTarget ??
    ((conversationId) =>
      resolveConversationRuntimeTarget(
        conversationId,
        options.workspaceIdentity,
        options.db,
        options.getProviderEnv
      ));
  const hooks = options.hooks ?? createDefaultRuntimeHooks(options);
  const conversationOperations = createConversationOperations({
    db: options.db,
    projects: options.projects,
    taskSessions: options.taskSessions,
    telemetry: options.telemetry,
    withCompensation: options.withCompensation,
  });
  const target = (conversationId: string) => resolveTarget(conversationId);
  const run = <T, E>(
    conversationId: string,
    work: (
      client: ConversationsHostRuntimesClient,
      target: ConversationRuntimeTarget
    ) => Promise<Result<T, E>>
  ) => withConversationRuntime(options.runtimes, target(conversationId), work);

  const acpSessions = modelProvider(conversationsContract.acp.sessions, (key, name) =>
    resolveRuntimeSource(options.runtimes, Promise.resolve(LOCAL_HOST_REF), (client) =>
      client.acp.sessions.state(key, name).asLiveSource()
    )
  );
  const acpSession = modelProvider(conversationsContract.acp.session, (key, name) =>
    resolveConversationRuntimeSource(options.runtimes, target(key.conversationId), (client) =>
      client.acp.session.state(key, name).asLiveSource()
    )
  );
  const tuiSessions = modelProvider(conversationsContract.tui.sessions, (key, name) =>
    resolveRuntimeSource(options.runtimes, Promise.resolve(LOCAL_HOST_REF), (client) =>
      client.tuiAgents.sessions.state(key, name).asLiveSource()
    )
  );

  return createController(conversationsContract, {
    getConversations: () => conversationOperations.getConversations(),
    createConversation: (input) => conversationOperations.createConversation(input),
    deleteConversation: ({ projectId, taskId, conversationId }) =>
      conversationOperations.deleteConversation(projectId, taskId, conversationId),
    hydrateConversation: ({ projectId, taskId, conversationId }) =>
      conversationOperations.hydrateConversation(projectId, taskId, conversationId),
    dehydrateConversation: ({ projectId, taskId, conversationId }) =>
      conversationOperations.dehydrateConversation(projectId, taskId, conversationId),
    renameConversation: ({ conversationId, name }) =>
      conversationOperations.renameConversation(conversationId, name),
    getConversationsForTask: ({ projectId, taskId }) =>
      conversationOperations.getConversationsForTask(projectId, taskId),
    getConversationsForProject: ({ projectId }) =>
      conversationOperations.getConversationsForProject(projectId),
    markConversationSeen: ({ conversationId }) =>
      conversationOperations.markConversationSeen(conversationId),
    events: conversationWireEvents,
    acp: {
      startSession: async ({ conversationId }, meta) => {
        const runtimeTarget = await target(conversationId);
        if (!runtimeTarget.acpInput) {
          throw missingAcpInputError(runtimeTarget);
        }
        const input = runtimeTarget.acpInput;
        return withConversationRuntime(
          options.runtimes,
          Promise.resolve(runtimeTarget),
          async (client) => {
            const result = await client.acp.startSession({ input }, callOptions(meta));
            if (result.success) {
              await hooks.persistAcpSessionId(runtimeTarget, result.data.sessionId);
            }
            return result;
          }
        );
      },
      resumeSession: async ({ conversationId }, meta) => {
        const runtimeTarget = await target(conversationId);
        const input = runtimeTarget.acpInput;
        if (!input) {
          throw missingAcpInputError(runtimeTarget);
        }
        if (!input.sessionId) {
          throw new Error(`Conversation '${conversationId}' has no ACP session to resume`);
        }
        const sessionId = input.sessionId;
        return withConversationRuntime(
          options.runtimes,
          Promise.resolve(runtimeTarget),
          async (client) => {
            const result = await client.acp.resumeSession(
              { input: { ...input, sessionId } },
              callOptions(meta)
            );
            if (result.success) {
              await hooks.persistAcpSessionId(runtimeTarget, result.data.sessionId);
            }
            return result;
          }
        );
      },
      stopSession: (input, meta) =>
        run(input.conversationId, (client) => client.acp.stopSession(input, callOptions(meta))),
      killSession: (input, meta) =>
        run(input.conversationId, (client) => client.acp.killSession(input, callOptions(meta))),
      sendPrompt: (input, meta) =>
        run(input.conversationId, (client) => client.acp.sendPrompt(input, callOptions(meta))),
      queuePrompt: (input, meta) =>
        run(input.conversationId, (client) => client.acp.queuePrompt(input, callOptions(meta))),
      editQueuedPrompt: (input, meta) =>
        run(input.conversationId, (client) =>
          client.acp.editQueuedPrompt(input, callOptions(meta))
        ),
      deleteQueuedPrompt: (input, meta) =>
        run(input.conversationId, (client) =>
          client.acp.deleteQueuedPrompt(input, callOptions(meta))
        ),
      changeQueuePromptOrder: (input, meta) =>
        run(input.conversationId, (client) =>
          client.acp.changeQueuePromptOrder(input, callOptions(meta))
        ),
      cancelTurn: (input, meta) =>
        run(input.conversationId, (client) => client.acp.cancelTurn(input, callOptions(meta))),
      setModelOption: (input, meta) =>
        run(input.conversationId, (client) => client.acp.setModelOption(input, callOptions(meta))),
      setModeOption: async (input, meta) => {
        const runtimeTarget = await target(input.conversationId);
        return withConversationRuntime(
          options.runtimes,
          Promise.resolve(runtimeTarget),
          async (client) => {
            const result = await client.acp.setModeOption(input, callOptions(meta));
            if (result.success) {
              await hooks.persistAcpMode(runtimeTarget, input.value);
            }
            return result;
          }
        );
      },
      resolvePermission: (input, meta) =>
        run(input.conversationId, (client) =>
          client.acp.resolvePermission(input, callOptions(meta))
        ),
      setPromptDraft: (input, meta) =>
        run(input.conversationId, (client) => client.acp.setPromptDraft(input, callOptions(meta))),
      exportACPTranscript: (input, meta) =>
        run(input.conversationId, (client) =>
          client.acp.exportACPTranscript(input, callOptions(meta))
        ),
      exportRawAcpLog: (input, meta) =>
        run(input.conversationId, (client) => client.acp.exportRawAcpLog(input, callOptions(meta))),
      uploadAttachment: ({ conversationId, originalPath }, file, meta) =>
        run(conversationId, (client) =>
          client.acp.uploadAttachment({ originalPath }, file, callOptions(meta))
        ),
      downloadAttachment: ({ conversationId, id }, meta) =>
        openAttachmentDownload(options.runtimes, target(conversationId), id, callOptions(meta)),
      deleteAttachment: ({ conversationId, id }, meta) =>
        run(conversationId, (client) => client.acp.deleteAttachment({ id }, callOptions(meta))),
      getHistory: (input, meta) =>
        run(input.conversationId, (client) => client.acp.getHistory(input, callOptions(meta))),
      sessions: acpSessions,
      session: acpSession,
      terminalOutput: async ({ conversationId, terminalId }) =>
        resolveConversationRuntimeSource(options.runtimes, target(conversationId), (client) =>
          client.acp.terminalOutput.handle({ terminalId }).asLiveSource()
        ),
    },
    tui: {
      startSession: (input, meta) =>
        run(input.input.conversationId, (client) =>
          client.tuiAgents.startSession(input, callOptions(meta))
        ),
      resumeSession: (input, meta) =>
        run(input.input.conversationId, (client) =>
          client.tuiAgents.resumeSession(input, callOptions(meta))
        ),
      stopSession: (input, meta) =>
        run(input.conversationId, (client) =>
          client.tuiAgents.stopSession(input, callOptions(meta))
        ),
      deactivateSession: (input, meta) =>
        run(input.conversationId, (client) =>
          client.tuiAgents.deactivateSession(input, callOptions(meta))
        ),
      deleteSession: (input, meta) =>
        run(input.conversationId, (client) =>
          client.tuiAgents.deleteSession(input, callOptions(meta))
        ),
      killSession: (input, meta) =>
        run(input.conversationId, (client) =>
          client.tuiAgents.killSession(input, callOptions(meta))
        ),
      sendInput: async (input, meta) => {
        const runtimeTarget = await target(input.conversationId);
        return withConversationRuntime(
          options.runtimes,
          Promise.resolve(runtimeTarget),
          async (client) => {
            const result = await client.tuiAgents.sendInput(input, callOptions(meta));
            if (result.success && input.data.includes('\r')) {
              await hooks.recordTuiInput(runtimeTarget);
            }
            return result;
          }
        );
      },
      resize: (input, meta) =>
        run(input.conversationId, (client) => client.tuiAgents.resize(input, callOptions(meta))),
      output: async ({ conversationId }) =>
        resolveConversationRuntimeSource(options.runtimes, target(conversationId), (client) =>
          client.tuiAgents.output.handle({ conversationId }).asLiveSource()
        ),
      sessions: tuiSessions,
    },
  });
}

function createDefaultRuntimeHooks(
  options: Pick<CreateConversationsWireControllerOptions, 'db' | 'logger' | 'telemetry'>
): ConversationRuntimeHooks {
  const { db, logger, telemetry } = options;
  return {
    async persistAcpSessionId(target, sessionId) {
      const result = await setSessionId(target.conversationId, sessionId, db);
      if (!result.success) {
        logger.warn('ACP runtime failed to persist returned session id', {
          conversationId: target.conversationId,
          error: result.error,
        });
        return;
      }
      if (target.sessionId === sessionId) return;
      conversationWireEvents.emit(undefined, {
        type: 'changed',
        conversationId: target.conversationId,
        taskId: result.data.taskId,
        projectId: result.data.projectId,
        changes: { sessionId },
      });
    },
    async persistAcpMode(target, modeId) {
      const result = await setConversationModeId(target.conversationId, modeId, db);
      if (!result.success) {
        logger.warn('ACP runtime failed to persist selected mode id', {
          conversationId: target.conversationId,
          error: result.error,
        });
        return;
      }
      if (target.modeId === modeId) return;
      conversationWireEvents.emit(undefined, {
        type: 'changed',
        conversationId: target.conversationId,
        taskId: result.data.taskId,
        projectId: result.data.projectId,
        changes: { modeId },
      });
    },
    async recordTuiInput(target) {
      if (target.providerId) {
        telemetry.capture('agent_run_started', {
          provider: target.providerId,
          project_id: target.projectId,
          task_id: target.taskId,
          conversation_id: target.conversationId,
        });
      }
      const lastInteractedAt = new Date().toISOString();
      await touchConversation(target.conversationId, lastInteractedAt, db);
      conversationWireEvents.emit(undefined, {
        type: 'changed',
        conversationId: target.conversationId,
        taskId: target.taskId,
        projectId: target.projectId,
        changes: { lastInteractedAt },
      });
    },
  };
}

function missingAcpInputError(target: ConversationRuntimeTarget): Error {
  if (target.conversationType === 'acp' && !target.workspacePath) {
    return new Error(
      `Workspace for conversation '${target.conversationId}' is not provisioned yet`
    );
  }
  return new Error(`Conversation '${target.conversationId}' is not an ACP conversation`);
}

async function resolveConversationRuntimeTarget(
  conversationId: string,
  workspaceIdentity: WorkspaceIdentityResolver,
  db: AppDb,
  getProviderEnv?: (providerId: string) => Promise<Record<string, string> | undefined>
): Promise<ConversationRuntimeTarget> {
  const [row] = await db
    .select({
      projectId: conversations.projectId,
      taskId: conversations.taskId,
      providerId: conversations.provider,
      sessionId: conversations.sessionId,
      config: conversations.config,
      type: conversations.type,
      workspaceId: tasks.workspaceId,
    })
    .from(conversations)
    .leftJoin(
      tasks,
      and(eq(tasks.id, conversations.taskId), eq(tasks.projectId, conversations.projectId))
    )
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!row) throw new Error(`Conversation '${conversationId}' was not found`);

  const identity = row.workspaceId ? await workspaceIdentity.resolve(row.workspaceId) : null;
  const acpConfig = row.config?.type === 'acp' ? row.config : undefined;
  const initialQueue =
    row.sessionId === null
      ? acpConfig?.initialQueue?.length
        ? acpConfig.initialQueue
        : acpConfig?.initialPrompt?.trim()
          ? [{ text: acpConfig.initialPrompt }]
          : undefined
      : undefined;
  const workspacePath = identity?.path;
  // Provider process env originates solely from trusted main-process settings.
  // The renderer only supplies a conversation id and cannot inject spawn variables.
  const providerEnv =
    row.providerId && getProviderEnv ? await getProviderEnv(row.providerId) : undefined;
  const acpInput =
    row.type === 'acp' && workspacePath && row.providerId
      ? {
          conversationId,
          providerId: row.providerId,
          cwd: workspacePath,
          sessionId: row.sessionId,
          model: acpConfig?.model ?? null,
          modeId: acpConfig?.modeId ?? null,
          ...(initialQueue && { initialQueue }),
          ...(providerEnv && { env: providerEnv }),
        }
      : undefined;

  return {
    conversationId,
    projectId: row.projectId,
    taskId: row.taskId,
    conversationType: row.type === 'acp' ? 'acp' : 'pty',
    providerId: row.providerId,
    sessionId: row.sessionId,
    modeId: acpConfig?.modeId ?? null,
    workspacePath,
    host: identity?.host ?? LOCAL_HOST_REF,
    acpInput,
  };
}

async function withConversationRuntime<T, E>(
  runtimes: ConversationsRuntimeBroker,
  targetPromise: Promise<ConversationRuntimeTarget>,
  work: (
    client: ConversationsHostRuntimesClient,
    target: ConversationRuntimeTarget
  ) => Promise<Result<T, E>>
): Promise<Result<T, E | RuntimeResolveError>> {
  const target = await targetPromise;
  const result = await runtimes.client(target.host);
  if (!result.success) return err(result.error);
  return await work(result.data, target);
}

function callOptions(meta: CallMeta): { signal?: AbortSignal } {
  return meta.signal ? { signal: meta.signal } : {};
}

function modelProvider<Group extends LiveModelDef>(
  contract: Group,
  resolveState: LiveModelProvider<Group>['resolveState']
): LiveModelProvider<Group> {
  return {
    kind: 'liveModelProvider',
    contract,
    resolveState,
    async runMutation() {
      throw new Error(`Live model '${contract.id}' has no mutations`);
    },
  };
}

async function resolveConversationRuntimeSource(
  runtimes: ConversationsRuntimeBroker,
  targetPromise: Promise<ConversationRuntimeTarget>,
  source: (client: ConversationsHostRuntimesClient) => LiveSource
): Promise<LiveSource> {
  return resolveRuntimeSource(
    runtimes,
    targetPromise.then((target) => target.host),
    source
  );
}

async function resolveRuntimeSource(
  runtimes: ConversationsRuntimeBroker,
  hostPromise: Promise<HostRef>,
  source: (client: ConversationsHostRuntimesClient) => LiveSource
): Promise<LiveSource> {
  const result = await runtimes.client(await hostPromise);
  if (!result.success) throwConversationsRuntimeResolveError(result.error);
  return source(result.data);
}

async function openAttachmentDownload(
  runtimes: ConversationsRuntimeBroker,
  targetPromise: Promise<ConversationRuntimeTarget>,
  id: string,
  options: { signal?: AbortSignal }
) {
  const target = await targetPromise;
  const runtime = await runtimes.client(target.host);
  if (!runtime.success) return err(runtime.error);
  const result = await runtime.data.acp.downloadAttachment({ id }, options);
  if (!result.success) return result;
  return {
    success: true as const,
    data: { meta: result.data.meta, source: result.data.chunks() },
  };
}
